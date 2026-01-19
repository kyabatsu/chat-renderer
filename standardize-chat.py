#!/usr/bin/env python3
"""
Chat Format Converter
Converts various chat dump formats to unified schema for rendering.

Supported formats:
- TwitchDownloader (single JSON with comments array)
- chat_downloader (JSONL, one message per line)
- yt-dlp live (JSONL with replayChatItemAction)
- yt-dlp post-hoc (JSONL, slightly different structure - TODO: clarify differences)

Usage:
    python convert_chat.py <input.json>
    python convert_chat.py <input.json> --dry-run
"""

import json
import sys
import os
import re
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum


# === Unified Schema Dataclasses ===

@dataclass
class Author:
    id: str
    name: str
    color: Optional[str] = None
    badges: Optional[List[str]] = None  # Filenames: ["subscriber_24.png", "vip_1.png"]


@dataclass
class Segment:
    type: str  # "text" or "emoji"
    value: Optional[str] = None      # For text
    id: Optional[str] = None         # For emoji (filename or emote ID)
    name: Optional[str] = None       # For emoji display name


@dataclass 
class Content:
    raw: str
    segments: List[Segment]


@dataclass
class SuperchatData:
    amount: float
    currency: str
    tier: Optional[int] = None


@dataclass
class BitsData:
    amount: int
    tier: Optional[int] = None


@dataclass
class MembershipData:
    tier: Optional[str] = None
    months: Optional[int] = None
    is_gift: bool = False
    gift_count: Optional[int] = None


@dataclass
class UnifiedMessage:
    id: str
    timestamp_ms: int
    type: str  # "chat", "superchat", "bits", "membership", "gift", "deleted"
    author: Author
    content: Content
    superchat: Optional[SuperchatData] = None
    bits: Optional[BitsData] = None
    membership: Optional[MembershipData] = None


# === Format Detection ===

class ChatFormat(Enum):
    TWITCH_DOWNLOADER = "twitch_downloader"
    CHAT_DOWNLOADER = "chat_downloader"
    YTDLP_LIVE = "ytdlp_live"
    YTDLP_POSTHOC = "ytdlp_posthoc"  # TODO: clarify differences from live
    UNKNOWN = "unknown"


def detect_format(file_path: str) -> ChatFormat:
    """Detect chat format by peeking at file structure."""
    
    with open(file_path, 'r', encoding='utf-8') as f:
        # Try to read as single JSON first (TwitchDownloader)
        try:
            f.seek(0)
            data = json.load(f)
            
            # TwitchDownloader has FileInfo and comments array
            if isinstance(data, dict) and 'FileInfo' in data and 'comments' in data:
                return ChatFormat.TWITCH_DOWNLOADER
            
        except json.JSONDecodeError:
            pass
        
        # Try JSONL (one JSON object per line)
        f.seek(0)
        first_line = f.readline().strip()
        if not first_line:
            return ChatFormat.UNKNOWN
            
        try:
            first_obj = json.loads(first_line)
            
            # chat_downloader: has client_nonce, message_id, author
            if 'client_nonce' in first_obj and 'message_id' in first_obj:
                return ChatFormat.CHAT_DOWNLOADER
            
            # yt-dlp: has replayChatItemAction
            if 'replayChatItemAction' in first_obj:
                # Live has videoOffsetTimeMsec at root + isLive flag
                # Post-hoc has videoOffsetTimeMsec inside replayChatItemAction
                if 'isLive' in first_obj or 'videoOffsetTimeMsec' in first_obj:
                    return ChatFormat.YTDLP_LIVE
                else:
                    return ChatFormat.YTDLP_POSTHOC
            
        except json.JSONDecodeError:
            pass
    
    return ChatFormat.UNKNOWN


# === Converters ===

class BaseConverter:
    """Base class for format converters."""
    
    def __init__(self, channel_emotes_path: Optional[str] = None):
        """
        Args:
            channel_emotes_path: Path to channel_emotes.json for filtering
        """
        self.channel_emotes = set()
        if channel_emotes_path and os.path.exists(channel_emotes_path):
            with open(channel_emotes_path, 'r') as f:
                self.channel_emotes = set(json.load(f))
    
    def is_channel_emote(self, emote_id: str) -> bool:
        """Check if emote belongs to the channel."""
        if not self.channel_emotes:
            return True  # No filter, allow all
        return emote_id in self.channel_emotes
    
    def convert(self, file_path: str) -> List[UnifiedMessage]:
        raise NotImplementedError


class TwitchDownloaderConverter(BaseConverter):
    """Convert TwitchDownloader JSON format."""
    
    def convert(self, file_path: str) -> List[UnifiedMessage]:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        messages = []
        for comment in data.get('comments', []):
            msg = self._convert_comment(comment)
            if msg:
                messages.append(msg)
        
        return messages
    
    def _convert_comment(self, comment: Dict[str, Any]) -> Optional[UnifiedMessage]:
        """Convert a single TwitchDownloader comment."""
        
        msg_data = comment.get('message', {})
        commenter = comment.get('commenter', {})
        
        # Author
        badges = []
        for badge in msg_data.get('user_badges', []):
            badge_id = badge.get('_id', '')
            version = badge.get('version', '1')
            badges.append(f"{badge_id}_{version}.png")
        
        author = Author(
            id=commenter.get('_id', ''),
            name=commenter.get('display_name', commenter.get('name', '')),
            color=None,
            badges=badges if badges else None
        )
        
        # Content segments
        raw_text = msg_data.get('body', '')
        segments = self._parse_fragments(msg_data.get('fragments', []))
        
        content = Content(raw=raw_text, segments=segments)
        
        # Timestamp: content_offset_seconds -> milliseconds
        timestamp_ms = int(comment.get('content_offset_seconds', 0) * 1000)
        
        # Message type (basic - extend for bits/subs if needed)
        msg_type = 'chat'
        bits_spent = msg_data.get('bits_spent', 0)
        bits_data = None
        if bits_spent > 0:
            msg_type = 'bits'
            bits_data = BitsData(amount=bits_spent)
        
        return UnifiedMessage(
            id=comment.get('_id', ''),
            timestamp_ms=timestamp_ms,
            type=msg_type,
            author=author,
            content=content,
            bits=bits_data
        )
    
    def _parse_fragments(self, fragments: List[Dict]) -> List[Segment]:
        """Parse TwitchDownloader fragments into segments."""
        segments = []
        
        for frag in fragments:
            emoticon = frag.get('emoticon')
            text = frag.get('text', '')
            
            if emoticon and emoticon.get('emoticon_id'):
                emote_id = emoticon['emoticon_id']
                # Check if channel emote, otherwise use placeholder
                if self.is_channel_emote(emote_id):
                    # Try .gif first, fall back to .png (renderer handles this)
                    segments.append(Segment(
                        type='emoji',
                        id=emote_id,  # Renderer will try .gif then .png
                        name=text.strip()
                    ))
                else:
                    # Non-channel emote: render as text placeholder
                    segments.append(Segment(type='text', value=f":{text.strip()}:"))
            else:
                if text:
                    segments.append(Segment(type='text', value=text))
        
        return segments


class ChatDownloaderConverter(BaseConverter):
    """Convert chat_downloader JSONL format (Twitch)."""
    
    def convert(self, file_path: str) -> List[UnifiedMessage]:
        messages = []
        
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    msg = self._convert_message(obj)
                    if msg:
                        messages.append(msg)
                except json.JSONDecodeError:
                    continue
        
        return messages
    
    def _convert_message(self, obj: Dict[str, Any]) -> Optional[UnifiedMessage]:
        """Convert a single chat_downloader message."""
        
        author_data = obj.get('author', {})
        
        # Badges
        badges = []
        for badge in author_data.get('badges', []):
            name = badge.get('name', '')
            version = badge.get('version', '1')
            badges.append(f"{name}_{version}.png")
        
        author = Author(
            id=author_data.get('id', ''),
            name=author_data.get('display_name', author_data.get('name', '')),
            color=None,
            badges=badges if badges else None
        )
        
        # Content
        raw_text = obj.get('message', '')
        segments = self._parse_message_with_emotes(raw_text, obj.get('emotes', []))
        
        content = Content(raw=raw_text, segments=segments)
        
        # Timestamp is in milliseconds (relative to stream start)
        timestamp_ms = obj.get('timestamp', 0)
        
        # Determine type
        msg_type = 'chat'
        # TODO: Detect bits, subs, etc. based on message_type or action_type
        
        return UnifiedMessage(
            id=obj.get('message_id', ''),
            timestamp_ms=timestamp_ms,
            type=msg_type,
            author=author,
            content=content
        )
    
    def _parse_message_with_emotes(self, text: str, emotes: List[Dict]) -> List[Segment]:
        """Parse message text with emote locations."""
        if not emotes:
            return [Segment(type='text', value=text)] if text else []
        
        # Build list of (start, end, emote_info)
        emote_ranges = []
        for emote in emotes:
            emote_id = emote.get('id', '')
            emote_name = emote.get('name', '')
            for loc in emote.get('locations', []):
                # Location format: "start-end"
                match = re.match(r'(\d+)-(\d+)', loc)
                if match:
                    start, end = int(match.group(1)), int(match.group(2))
                    emote_ranges.append((start, end + 1, emote_id, emote_name))
        
        # Sort by start position
        emote_ranges.sort(key=lambda x: x[0])
        
        # Build segments
        segments = []
        pos = 0
        
        for start, end, emote_id, emote_name in emote_ranges:
            # Text before emote
            if pos < start:
                segments.append(Segment(type='text', value=text[pos:start]))
            
            # Emote
            if self.is_channel_emote(emote_id):
                segments.append(Segment(type='emoji', id=emote_id, name=emote_name))
            else:
                segments.append(Segment(type='text', value=f":{emote_name}:"))
            
            pos = end
        
        # Remaining text
        if pos < len(text):
            segments.append(Segment(type='text', value=text[pos:]))
        
        return segments


class YtdlpLiveConverter(BaseConverter):
    """Convert yt-dlp live chat JSONL format (YouTube)."""
    
    def convert(self, file_path: str) -> List[UnifiedMessage]:
        messages = []
        
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    msg = self._convert_action(obj)
                    if msg:
                        messages.append(msg)
                except json.JSONDecodeError:
                    continue
        
        return messages
    
    def _convert_action(self, obj: Dict[str, Any]) -> Optional[UnifiedMessage]:
        """Convert a single yt-dlp replayChatItemAction."""
        
        replay_action = obj.get('replayChatItemAction', {})
        actions = replay_action.get('actions', [])
        
        if not actions:
            return None
        
        # Timestamp location differs between live and post-hoc
        # Live: at root level
        # Post-hoc: inside replayChatItemAction
        timestamp_ms = int(
            obj.get('videoOffsetTimeMsec') or 
            replay_action.get('videoOffsetTimeMsec') or 
            0
        )
        
        for action in actions:
            add_action = action.get('addChatItemAction', {})
            item = add_action.get('item', {})
            
            # Regular text message
            if 'liveChatTextMessageRenderer' in item:
                return self._convert_text_message(
                    item['liveChatTextMessageRenderer'], 
                    timestamp_ms
                )
            
            # Membership
            if 'liveChatMembershipItemRenderer' in item:
                return self._convert_membership(
                    item['liveChatMembershipItemRenderer'],
                    timestamp_ms
                )
            
            # Super Chat
            if 'liveChatPaidMessageRenderer' in item:
                return self._convert_superchat(
                    item['liveChatPaidMessageRenderer'],
                    timestamp_ms
                )
            
            # TODO: Handle other types (stickers, gifts, etc.)
        
        return None
    
    def _convert_text_message(self, renderer: Dict, timestamp_ms: int) -> UnifiedMessage:
        """Convert liveChatTextMessageRenderer."""
        
        # Author
        author_name = renderer.get('authorName', {}).get('simpleText', '')
        author_id = renderer.get('authorExternalChannelId', '')
        
        # Badges
        badges = []
        for badge in renderer.get('authorBadges', []):
            badge_renderer = badge.get('liveChatAuthorBadgeRenderer', {})
            tooltip = badge_renderer.get('tooltip', '')
            # YouTube badges don't have simple IDs like Twitch
            # We'll use the tooltip as identifier
            # TODO: Map to actual badge images or download from thumbnails
            if tooltip:
                # Sanitize for filename
                badge_id = re.sub(r'[^a-zA-Z0-9_]', '_', tooltip.lower())
                badges.append(f"yt_{badge_id}.png")
        
        author = Author(
            id=author_id,
            name=author_name.lstrip('@'),
            color=None,  # YouTube doesn't have user colors in same way
            badges=badges if badges else None
        )
        
        # Content
        runs = renderer.get('message', {}).get('runs', [])
        raw_text, segments = self._parse_runs(runs)
        
        content = Content(raw=raw_text, segments=segments)
        
        return UnifiedMessage(
            id=renderer.get('id', ''),
            timestamp_ms=timestamp_ms,
            type='chat',
            author=author,
            content=content
        )
    
    def _convert_membership(self, renderer: Dict, timestamp_ms: int) -> UnifiedMessage:
        """Convert liveChatMembershipItemRenderer."""
        
        author_name = renderer.get('authorName', {}).get('simpleText', '')
        author_id = renderer.get('authorExternalChannelId', '')
        
        author = Author(
            id=author_id,
            name=author_name.lstrip('@'),
            color=None,
            badges=None
        )
        
        # Header subtext contains membership info
        header_runs = renderer.get('headerSubtext', {}).get('runs', [])
        header_text = ''.join(r.get('text', '') for r in header_runs)
        
        content = Content(raw=header_text, segments=[Segment(type='text', value=header_text)])
        
        return UnifiedMessage(
            id=renderer.get('id', ''),
            timestamp_ms=timestamp_ms,
            type='membership',
            author=author,
            content=content,
            membership=MembershipData(is_gift=False)
        )
    
    def _convert_superchat(self, renderer: Dict, timestamp_ms: int) -> UnifiedMessage:
        """Convert liveChatPaidMessageRenderer."""
        
        author_name = renderer.get('authorName', {}).get('simpleText', '')
        author_id = renderer.get('authorExternalChannelId', '')
        
        author = Author(
            id=author_id,
            name=author_name.lstrip('@'),
            color=None,
            badges=None
        )
        
        # Message
        runs = renderer.get('message', {}).get('runs', [])
        raw_text, segments = self._parse_runs(runs)
        content = Content(raw=raw_text, segments=segments)
        
        # Amount
        amount_text = renderer.get('purchaseAmountText', {}).get('simpleText', '')
        # Parse "$5.00" or "¥500" etc.
        amount_match = re.search(r'[\d,.]+', amount_text)
        amount = float(amount_match.group().replace(',', '')) if amount_match else 0
        currency = re.sub(r'[\d,.\s]+', '', amount_text).strip() or '$'
        
        return UnifiedMessage(
            id=renderer.get('id', ''),
            timestamp_ms=timestamp_ms,
            type='superchat',
            author=author,
            content=content,
            superchat=SuperchatData(amount=amount, currency=currency)
        )
    
    def _parse_runs(self, runs: List[Dict]) -> tuple[str, List[Segment]]:
        """Parse YouTube message runs into raw text and segments."""
        raw_parts = []
        segments = []
        
        for run in runs:
            if 'text' in run:
                text = run['text']
                raw_parts.append(text)
                segments.append(Segment(type='text', value=text))
            
            elif 'emoji' in run:
                emoji = run['emoji']
                emoji_id = emoji.get('emojiId', '')
                # Get name from shortcuts or searchTerms
                shortcuts = emoji.get('shortcuts', [])
                name = shortcuts[0].strip(':') if shortcuts else 'emoji'
                
                # Check if it's a standard Unicode emoji (emojiId is the actual character)
                # vs custom channel emoji (emojiId is a long ID string)
                is_unicode = len(emoji_id) <= 4 or not emoji_id.startswith('UC')
                is_custom = emoji.get('isCustomEmoji', False)
                
                if is_unicode and not is_custom:
                    # Standard Unicode emoji - render as the actual character
                    raw_parts.append(emoji_id)
                    segments.append(Segment(type='text', value=emoji_id))
                elif is_custom:
                    # Custom channel emoji
                    raw_parts.append(f":{name}:")
                    segments.append(Segment(type='emoji', id=emoji_id, name=name))
                else:
                    # Unknown - render as text placeholder
                    raw_parts.append(f":{name}:")
                    segments.append(Segment(type='text', value=f":{name}:"))
        
        return ''.join(raw_parts), segments


# === Main Converter Factory ===

def get_converter(format_type: ChatFormat, channel_emotes_path: Optional[str] = None) -> BaseConverter:
    """Get appropriate converter for format."""
    converters = {
        ChatFormat.TWITCH_DOWNLOADER: TwitchDownloaderConverter,
        ChatFormat.CHAT_DOWNLOADER: ChatDownloaderConverter,
        ChatFormat.YTDLP_LIVE: YtdlpLiveConverter,
        ChatFormat.YTDLP_POSTHOC: YtdlpLiveConverter,  # TODO: Separate if needed
    }
    
    converter_class = converters.get(format_type)
    if not converter_class:
        raise ValueError(f"No converter for format: {format_type}")
    
    return converter_class(channel_emotes_path)


def convert_file(input_path: str, channel_emotes_path: Optional[str] = None, dry_run: bool = False) -> str:
    """
    Convert chat file to unified format.
    
    Args:
        input_path: Path to input chat JSON/JSONL
        channel_emotes_path: Optional path to channel_emotes.json
        dry_run: If True, don't write files
    
    Returns:
        Path to converted file
    """
    input_path = Path(input_path)
    
    # Detect format
    print(f"Detecting format for: {input_path.name}")
    format_type = detect_format(str(input_path))
    print(f"  Detected: {format_type.value}")
    
    if format_type == ChatFormat.UNKNOWN:
        raise ValueError("Could not detect chat format")
    
    # Convert
    print(f"Converting...")
    converter = get_converter(format_type, channel_emotes_path)
    messages = converter.convert(str(input_path))
    print(f"  Converted {len(messages)} messages")
    
    # Sort by timestamp
    messages.sort(key=lambda m: m.timestamp_ms)
    
    # Build output
    output_data = {
        "metadata": {
            "source_format": format_type.value,
            "source_file": input_path.name,
            "message_count": len(messages),
        },
        "messages": [_message_to_dict(m) for m in messages]
    }
    
    if dry_run:
        print(f"  [DRY RUN] Would write {len(messages)} messages")
        print(f"  Sample message:")
        if messages:
            print(f"    {_message_to_dict(messages[0])}")
        return str(input_path)
    
    # Rename original to .archive
    archive_path = input_path.with_suffix(input_path.suffix + '.archive')
    if archive_path.exists():
        # Don't overwrite existing archive
        i = 1
        while archive_path.exists():
            archive_path = input_path.with_suffix(f"{input_path.suffix}.archive.{i}")
            i += 1
    
    print(f"  Archiving original to: {archive_path.name}")
    input_path.rename(archive_path)
    
    # Write converted file
    print(f"  Writing converted file: {input_path.name}")
    with open(input_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"Done!")
    return str(input_path)


def _message_to_dict(msg: UnifiedMessage) -> Dict:
    """Convert UnifiedMessage to dict, removing None values."""
    
    def clean_dict(d):
        if isinstance(d, dict):
            return {k: clean_dict(v) for k, v in d.items() if v is not None}
        elif isinstance(d, list):
            return [clean_dict(i) for i in d]
        else:
            return d
    
    # Convert dataclass to dict
    d = {
        'id': msg.id,
        'timestamp_ms': msg.timestamp_ms,
        'type': msg.type,
        'author': {
            'id': msg.author.id,
            'name': msg.author.name,
            'color': msg.author.color,
            'badges': msg.author.badges,
        },
        'content': {
            'raw': msg.content.raw,
            'segments': [
                {k: v for k, v in asdict(s).items() if v is not None}
                for s in msg.content.segments
            ]
        }
    }
    
    if msg.superchat:
        d['superchat'] = asdict(msg.superchat)
    if msg.bits:
        d['bits'] = asdict(msg.bits)
    if msg.membership:
        d['membership'] = {
            'tier': msg.membership.tier,
            'months': msg.membership.months,
            'isGift': msg.membership.is_gift,
            'giftCount': msg.membership.gift_count,
        }
    
    return clean_dict(d)


# === CLI ===

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Convert chat formats to unified schema')
    parser.add_argument('input', help='Input chat JSON/JSONL file')
    parser.add_argument('--channel-emotes', help='Path to channel_emotes.json for filtering')
    parser.add_argument('--dry-run', action='store_true', help="Don't write files, just show what would happen")
    
    args = parser.parse_args()
    
    try:
        convert_file(args.input, args.channel_emotes, args.dry_run)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
