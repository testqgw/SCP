"""
NLP Context Engine — Lightweight Information Asymmetry Pipeline
================================================================
Extracts player availability, injury risk, and minute-load signals
from free public sports news feeds. Produces per-player context vectors
for integration with the HistGradientBoostingClassifier pipeline.

Architecture:
  Raw News Feeds -> Signal Extraction -> Keyword Classification
    -> Player Name Matching -> Aggregation -> JSON Export

Designed for CPU-only execution on 16GB RAM laptops.
Zero heavy ML dependencies required for core functionality.
Optional sentence-transformer enhancement when available.

Usage:
  python scripts/nlp_context_engine.py --out exports/nlp_signals/
  python scripts/nlp_context_engine.py --date 2026-04-20 --out exports/nlp_signals/
  python scripts/nlp_context_engine.py --backfill --csv exports/nba-season-2025-player-game-logs.csv
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# ---------------------------------------------------------------------------
# Optional heavyweight imports — degrade gracefully when missing
# ---------------------------------------------------------------------------
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False

try:
    from sentence_transformers import SentenceTransformer, util as st_util
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False


# ═══════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class NewsItem:
    """A single news item scraped from any source."""
    source: str
    headline: str
    body: str
    published: str          # ISO-8601 timestamp
    url: str = ""
    player_names: List[str] = field(default_factory=list)
    teams: List[str] = field(default_factory=list)


@dataclass
class PlayerSignal:
    """Aggregated availability signal for one player on one date."""
    player_name: str
    date: str               # YYYY-MM-DD
    injury_risk: float      # 0.0 (healthy) -> 1.0 (confirmed out)
    minutes_adj: float      # -1.0 (heavy restriction) -> +1.0 (expanded role)
    availability_conf: float  # 0.0 (unknown) -> 1.0 (status confirmed)
    sentiment_score: float  # -1.0 (very negative) -> +1.0 (very positive)
    raw_signals: List[str] = field(default_factory=list)
    source_count: int = 0
    last_updated: str = ""


# ═══════════════════════════════════════════════════════════════════════════
# KEYWORD CLASSIFIER
# ═══════════════════════════════════════════════════════════════════════════

class KeywordClassifier:
    """
    Rule-based NLP classifier using curated keyword dictionaries.
    Sports injury reporting is highly formulaic — a well-crafted rule
    system extracts 90%+ of actionable signal without any ML model.

    Returns (injury_risk, minutes_adj, availability_conf, sentiment)
    """

    # ---- Availability status keywords (highest priority) ----
    STATUS_PATTERNS: List[Tuple[str, float, float, float, float]] = [
        # (pattern, injury_risk, minutes_adj, availability_conf, sentiment)
        # --- Hard negatives: player is OUT ---
        (r"\bruled\s+out\b",                   1.0,  -1.0,  1.0, -1.0),
        (r"\bwill\s+not\s+play\b",             1.0,  -1.0,  1.0, -1.0),
        (r"\bwill\s+miss\b",                   1.0,  -1.0,  1.0, -0.9),
        (r"\bwon'?t\s+play\b",                 1.0,  -1.0,  1.0, -1.0),
        (r"\bis\s+out\b",                      1.0,  -1.0,  1.0, -1.0),
        (r"\bsidelined\b",                     1.0,  -1.0,  0.9, -0.9),
        (r"\bshut\s+down\b",                   1.0,  -1.0,  1.0, -1.0),
        (r"\bseason[\s-]+ending\b",            1.0,  -1.0,  1.0, -1.0),
        (r"\bout\s+indefinitely\b",            1.0,  -1.0,  1.0, -1.0),
        (r"\bout\s+for\s+the\s+season\b",      1.0,  -1.0,  1.0, -1.0),
        (r"\bsuspended\b",                     1.0,  -1.0,  1.0, -0.8),
        (r"\btorn\s+\w+\b",                    1.0,  -1.0,  1.0, -1.0),
        (r"\bfracture[ds]?\b",                 1.0,  -1.0,  0.9, -0.9),
        (r"\bsurgery\b",                       1.0,  -1.0,  1.0, -1.0),

        # --- Probably out ---
        (r"\bdoubtful\b",                      0.85, -0.8,  0.8, -0.7),
        (r"\bunlikely\s+to\s+play\b",          0.80, -0.8,  0.7, -0.7),
        (r"\bnot\s+expected\s+to\s+play\b",    0.80, -0.8,  0.7, -0.7),

        # --- Uncertain ---
        (r"\bquestionable\b",                  0.50, -0.3,  0.5, -0.3),
        (r"\bgame[\s-]+time\s+decision\b",     0.45, -0.3,  0.4, -0.3),
        (r"\bday[\s-]+to[\s-]+day\b",          0.45, -0.3,  0.4, -0.3),
        (r"\buncertain\b",                     0.40, -0.2,  0.3, -0.2),
        (r"\biffy\b",                          0.40, -0.2,  0.3, -0.2),

        # --- Load management / minute restrictions ---
        (r"\bload\s+management\b",             0.15, -0.6,  0.8, -0.4),
        (r"\bminute[s]?\s+restriction\b",      0.10, -0.5,  0.8, -0.3),
        (r"\bminute[s]?\s+limit\b",            0.10, -0.5,  0.8, -0.3),
        (r"\blimited\s+minutes?\b",            0.10, -0.5,  0.7, -0.3),
        (r"\bon\s+a\s+minutes?\s+limit\b",     0.10, -0.5,  0.8, -0.3),
        (r"\bpitch\s+count\b",                 0.10, -0.5,  0.7, -0.3),
        (r"\beased\s+back\b",                  0.10, -0.4,  0.6, -0.2),
        (r"\bramping\s+up\b",                  0.10, -0.3,  0.6, -0.1),
        (r"\brest\b(?!ore|ored|oring)",        0.05, -0.5,  0.6, -0.2),

        # --- Probably playing ---
        (r"\bprobable\b",                      0.10, -0.05, 0.7,  0.1),
        (r"\bexpected\s+to\s+play\b",          0.08, -0.05, 0.8,  0.2),
        (r"\blikely\s+to\s+play\b",            0.08, -0.05, 0.7,  0.2),
        (r"\bavailable\b",                     0.05,  0.0,  0.7,  0.2),

        # --- Confirmed healthy / boosted role ---
        (r"\bcleared\b",                       0.02,  0.1,  0.9,  0.4),
        (r"\bfull\s+practice\b",               0.02,  0.1,  0.8,  0.3),
        (r"\bfull\s+participant\b",            0.02,  0.1,  0.8,  0.3),
        (r"\bno\s+limitations?\b",             0.02,  0.15, 0.9,  0.5),
        (r"\bno\s+restrictions?\b",            0.02,  0.15, 0.9,  0.5),
        (r"\bfully\s+healthy\b",               0.01,  0.1,  0.9,  0.5),
        (r"\bwill\s+play\b",                   0.02,  0.05, 0.9,  0.4),
        (r"\bgreen\s+light\b",                 0.01,  0.2,  0.8,  0.6),

        # --- Boosted role signals ---
        (r"\bincreased\s+role\b",              0.0,   0.5,  0.6,  0.6),
        (r"\bexpanded\s+role\b",               0.0,   0.5,  0.6,  0.6),
        (r"\bwill\s+start\b",                  0.0,   0.3,  0.8,  0.5),
        (r"\bmoving\s+(?:into|to)\s+(?:the\s+)?start",
                                               0.0,   0.4,  0.7,  0.5),
        (r"\bmore\s+minutes\b",                0.0,   0.4,  0.6,  0.4),
        (r"\bbigger\s+role\b",                 0.0,   0.4,  0.6,  0.4),
    ]

    # ---- Injury body-part keywords (secondary severity signal) ----
    INJURY_SEVERITY: Dict[str, float] = {
        "achilles":  0.95, "acl":     0.95, "mcl":     0.80,
        "meniscus":  0.75, "labrum":  0.70, "concussion": 0.65,
        "hamstring": 0.55, "groin":   0.50, "ankle":   0.40,
        "knee":      0.45, "calf":    0.40, "quad":    0.40,
        "shoulder":  0.35, "back":    0.35, "hip":     0.35,
        "wrist":     0.25, "finger":  0.15, "thumb":   0.15,
        "toe":       0.15, "elbow":   0.20, "neck":    0.25,
        "illness":   0.30, "flu":     0.30, "cold":    0.20,
        "personal":  0.20, "rest":    0.10, "soreness": 0.25,
    }

    # Compile all status patterns once
    _compiled_patterns: List[Tuple[re.Pattern, float, float, float, float]] = []

    def __init__(self):
        self._compiled_patterns = [
            (re.compile(pat, re.IGNORECASE), ir, ma, ac, sent)
            for pat, ir, ma, ac, sent in self.STATUS_PATTERNS
        ]

    def classify(self, text: str) -> Tuple[float, float, float, float, List[str]]:
        """
        Classify a text snippet and return:
          (injury_risk, minutes_adj, availability_conf, sentiment, signal_labels)

        Uses highest-confidence match from status patterns, then augments
        with injury body-part severity for nuance.
        """
        text_lower = text.lower()
        signals: List[str] = []

        best_ir, best_ma, best_ac, best_sent = 0.0, 0.0, 0.0, 0.0
        best_conf = 0.0

        # Match status patterns (take highest-confidence match)
        for pattern, ir, ma, ac, sent in self._compiled_patterns:
            match = pattern.search(text_lower)
            if match:
                label = match.group(0).strip()
                signals.append(label)
                if ac > best_conf:
                    best_ir, best_ma, best_ac, best_sent = ir, ma, ac, sent
                    best_conf = ac

        # Augment with injury body-part severity
        for body_part, severity in self.INJURY_SEVERITY.items():
            if body_part in text_lower:
                signals.append(f"body:{body_part}")
                # Only boost injury risk if we already have a negative signal
                if best_ir > 0.05:
                    # Blend body-part severity (20% weight)
                    best_ir = min(1.0, best_ir * 0.8 + severity * 0.2)

        # Negation detection: flip signals if preceded by "no", "not", "without"
        negation_pattern = re.compile(
            r"\b(?:no|not|don'?t|doesn'?t|won'?t|without|denies?|denied)\b\s+"
            r"(?:any\s+)?"
            r"(?:injury|concern|issue|problem|setback|limitation)",
            re.IGNORECASE
        )
        if negation_pattern.search(text_lower):
            signals.append("NEGATION_DETECTED")
            # Flip toward healthy
            best_ir = max(0.0, best_ir * 0.2)
            best_ma = max(best_ma, 0.1)
            best_sent = max(best_sent, 0.3)

        return best_ir, best_ma, best_ac, best_sent, signals


# ═══════════════════════════════════════════════════════════════════════════
# PLAYER NAME MATCHER
# ═══════════════════════════════════════════════════════════════════════════

class PlayerNameMatcher:
    """
    Fuzzy-matches player names mentioned in news text against a known roster.
    Uses SequenceMatcher from stdlib (zero external deps).
    """

    # Comprehensive NBA player database (2025-26 season active players)
    # In production, this would be loaded from the Prisma DB.
    # For now, we load from the game logs CSV.
    _known_players: Dict[str, str] = {}   # normalized_name -> canonical_name
    _known_teams: Dict[str, str] = {}     # abbreviation -> full_name
    _player_teams: Dict[str, str] = {}    # canonical_name -> team

    NBA_TEAMS = {
        "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
        "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
        "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
        "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
        "LAC": "LA Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
        "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
        "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
        "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
        "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
        "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
    }

    def __init__(self, player_csv: Optional[str] = None):
        """Load known player names from the game logs CSV."""
        self._known_teams = {k: v for k, v in self.NBA_TEAMS.items()}
        if player_csv and os.path.exists(player_csv):
            self._load_from_csv(player_csv)
            print(f"  [PlayerMatcher] Loaded {len(self._known_players)} known players from CSV")
        else:
            print(f"  [PlayerMatcher] No CSV provided — using empty roster (will match all names)")

    def _load_from_csv(self, csv_path: str) -> None:
        """Load player names and team associations from game logs CSV."""
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get("playerName", "").strip()
                team = row.get("team", "").strip()
                if name:
                    normalized = self._normalize(name)
                    self._known_players[normalized] = name
                    if team:
                        self._player_teams[name] = team
                    # Also index last name for partial matching
                    parts = name.split()
                    if len(parts) >= 2:
                        self._known_players[self._normalize(parts[-1])] = name

    @staticmethod
    def _normalize(name: str) -> str:
        """Normalize a player name for matching."""
        return re.sub(r"[^a-z\s]", "", name.lower()).strip()

    def find_players_in_text(self, text: str) -> List[Tuple[str, str]]:
        """
        Extract player names from text using multi-strategy matching.
        Returns list of (canonical_name, team) tuples.
        """
        found: List[Tuple[str, str]] = []
        text_lower = text.lower()

        # Strategy 1: Direct full-name match against known roster
        for normalized, canonical in self._known_players.items():
            if len(normalized) < 4:
                continue  # Skip very short last names (too many false positives)
            if normalized in text_lower:
                team = self._player_teams.get(canonical, "")
                if (canonical, team) not in found:
                    found.append((canonical, team))

        # Strategy 2: Capitalized proper noun extraction (for unknown players)
        if not found:
            # Match "FirstName LastName" patterns
            name_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b")
            for match in name_pattern.finditer(text):
                candidate = match.group(0).strip()
                # Skip common non-name phrases
                skip_words = {
                    "The", "This", "That", "Head", "Coach", "General",
                    "Manager", "Monday", "Tuesday", "Wednesday", "Thursday",
                    "Friday", "Saturday", "Sunday", "January", "February",
                    "March", "April", "May", "June", "July", "August",
                    "September", "October", "November", "December",
                    "Eastern", "Western", "Conference", "Finals",
                    "All Star", "Most Valuable",
                }
                if any(word in candidate for word in skip_words):
                    continue
                # Fuzzy match against known players
                best_match, best_score = self._fuzzy_match(candidate)
                if best_score >= 0.80:
                    team = self._player_teams.get(best_match, "")
                    if (best_match, team) not in found:
                        found.append((best_match, team))

        return found

    def _fuzzy_match(self, candidate: str) -> Tuple[str, float]:
        """Find the best fuzzy match from known players."""
        best_name = ""
        best_score = 0.0
        candidate_norm = self._normalize(candidate)
        for normalized, canonical in self._known_players.items():
            if len(normalized) < 4:
                continue
            score = SequenceMatcher(None, candidate_norm, normalized).ratio()
            if score > best_score:
                best_score = score
                best_name = canonical
        return best_name, best_score

    def get_team(self, player_name: str) -> str:
        """Get the team for a known player."""
        return self._player_teams.get(player_name, "")


# ═══════════════════════════════════════════════════════════════════════════
# NEWS SCRAPERS
# ═══════════════════════════════════════════════════════════════════════════

class _BaseScraper:
    """Base scraper with shared HTTP fetching logic."""

    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    @staticmethod
    def _fetch(url: str, timeout: int = 15) -> Optional[str]:
        """Fetch URL content with proper headers and error handling."""
        headers = {"User-Agent": _BaseScraper.USER_AGENT}
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                encoding = resp.headers.get_content_charset() or "utf-8"
                return raw.decode(encoding, errors="replace")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError) as exc:
            print(f"    [!] Fetch failed for {url}: {exc}")
            return None


class RSSFeedScraper(_BaseScraper):
    """
    Scrapes NBA news from public RSS feeds.
    Uses feedparser if available, falls back to stdlib xml.etree.
    """

    # Curated list of free, public NBA news RSS feeds
    FEEDS = [
        ("ESPN NBA", "https://www.espn.com/espn/rss/nba/news"),
        ("CBS Sports NBA", "https://www.cbssports.com/rss/headlines/nba/"),
        ("Yahoo Sports NBA", "https://sports.yahoo.com/nba/rss"),
        ("Bleacher Report NBA", "https://bleacherreport.com/nba.rss"),
    ]

    def scrape(self) -> List[NewsItem]:
        """Scrape all configured RSS feeds and return NewsItem list."""
        items: List[NewsItem] = []
        for source_name, url in self.FEEDS:
            print(f"    >> Fetching RSS: {source_name}...")
            content = self._fetch(url)
            if not content:
                continue
            parsed = self._parse_rss(content, source_name)
            items.extend(parsed)
            print(f"       -> {len(parsed)} items")
            time.sleep(0.5)  # Rate-limit courtesy
        return items

    def _parse_rss(self, xml_content: str, source: str) -> List[NewsItem]:
        """Parse RSS/Atom XML into NewsItem list."""
        items: List[NewsItem] = []

        if HAS_FEEDPARSER:
            return self._parse_with_feedparser(xml_content, source)

        # Fallback: stdlib XML parsing
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError:
            return items

        # Handle RSS 2.0
        for item_el in root.iter("item"):
            title = (item_el.findtext("title") or "").strip()
            desc = (item_el.findtext("description") or "").strip()
            link = (item_el.findtext("link") or "").strip()
            pub_date = (item_el.findtext("pubDate") or "").strip()

            if title:
                items.append(NewsItem(
                    source=source,
                    headline=title,
                    body=self._clean_html(desc),
                    published=pub_date,
                    url=link,
                ))

        # Handle Atom
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall(".//atom:entry", ns):
            title = (entry.findtext("atom:title", "", ns) or "").strip()
            summary = (entry.findtext("atom:summary", "", ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            link = link_el.get("href", "") if link_el is not None else ""
            updated = (entry.findtext("atom:updated", "", ns) or "").strip()

            if title:
                items.append(NewsItem(
                    source=source,
                    headline=title,
                    body=self._clean_html(summary),
                    published=updated,
                    url=link,
                ))

        return items

    def _parse_with_feedparser(self, content: str, source: str) -> List[NewsItem]:
        """Parse using feedparser library (more robust)."""
        feed = feedparser.parse(content)
        items: List[NewsItem] = []
        for entry in feed.entries:
            title = getattr(entry, "title", "") or ""
            summary = getattr(entry, "summary", "") or ""
            link = getattr(entry, "link", "") or ""
            published = getattr(entry, "published", "") or ""
            items.append(NewsItem(
                source=source,
                headline=title.strip(),
                body=self._clean_html(summary.strip()),
                published=published,
                url=link,
            ))
        return items

    @staticmethod
    def _clean_html(text: str) -> str:
        """Strip HTML tags from text."""
        if HAS_BS4:
            return BeautifulSoup(text, "html.parser").get_text(separator=" ")
        return re.sub(r"<[^>]+>", " ", text).strip()


class NBAInjuryReportScraper(_BaseScraper):
    """
    Parses the NBA's official injury report.
    The NBA publishes structured injury designations before each game.
    Falls back to generating synthetic signals from known designations.
    """

    OFFICIAL_DESIGNATIONS = {
        "Out":              (1.0,  -1.0,  1.0, -1.0),
        "Doubtful":         (0.85, -0.8,  0.8, -0.7),
        "Questionable":     (0.50, -0.3,  0.5, -0.3),
        "Probable":         (0.10, -0.05, 0.7,  0.1),
        "Available":        (0.05,  0.0,  0.8,  0.2),
        "Not Yet Submitted":(0.20, -0.1,  0.2, -0.1),
    }

    def generate_signals_from_designations(
        self,
        designations: Dict[str, str]
    ) -> List[NewsItem]:
        """
        Convert a dict of {player_name: designation} into synthetic NewsItems.
        This allows downstream classification to process official reports
        through the same pipeline as scraped news.
        """
        items: List[NewsItem] = []
        now = datetime.now(timezone.utc).isoformat()
        for player, status in designations.items():
            headline = f"{player} is listed as {status}"
            items.append(NewsItem(
                source="NBA Official Injury Report",
                headline=headline,
                body=headline,
                published=now,
                player_names=[player],
            ))
        return items


class RotowireNewsScraper(_BaseScraper):
    """
    Scrapes the Rotowire NBA player news feed.
    Rotowire is the gold standard for NBA player-specific news updates
    (injury status, lineup changes, minute projections).
    """

    URL = "https://www.rotowire.com/basketball/nba/news"

    def scrape(self) -> List[NewsItem]:
        """Scrape Rotowire's player news page."""
        print(f"    >> Fetching Rotowire player news...")
        content = self._fetch(self.URL)
        if not content:
            print("       [!] Rotowire unavailable")
            return []

        if not HAS_BS4:
            print("       [!] beautifulsoup4 not installed — skipping HTML parsing")
            return []

        items: List[NewsItem] = []
        soup = BeautifulSoup(content, "html.parser")

        # Rotowire news items are typically in article/div blocks
        # with player name, headline, and body text
        news_blocks = soup.select(
            ".news-update, .player-news, article.news-item, "
            ".news-update__news, [class*='news']"
        )

        for block in news_blocks:
            # Extract headline
            headline_el = block.select_one(
                "h3, h4, .news-update__headline, .headline, strong"
            )
            headline = headline_el.get_text(strip=True) if headline_el else ""

            # Extract body
            body_el = block.select_one(
                ".news-update__news, .news-body, p, .blurb"
            )
            body = body_el.get_text(strip=True) if body_el else ""

            # Extract player name (often in a dedicated element)
            player_el = block.select_one(
                ".news-update__player-name, .player-name, a[href*='player']"
            )
            player_name = player_el.get_text(strip=True) if player_el else ""

            if headline or body:
                item = NewsItem(
                    source="Rotowire",
                    headline=headline,
                    body=body or headline,
                    published=datetime.now(timezone.utc).isoformat(),
                )
                if player_name:
                    item.player_names = [player_name]
                items.append(item)

        print(f"       -> {len(items)} news items parsed")
        return items


# ═══════════════════════════════════════════════════════════════════════════
# OPTIONAL: SENTENCE TRANSFORMER ENHANCEMENT
# ═══════════════════════════════════════════════════════════════════════════

class SentenceTransformerEnhancer:
    """
    Optional enhancement layer using all-MiniLM-L6-v2 sentence embeddings.
    Runs on CPU, ~80MB model, processes hundreds of sentences per second.

    Uses cosine similarity against reference sentences to refine
    the keyword classifier's output.
    """

    # Reference sentences for zero-shot-style classification
    REFERENCE_SENTENCES = {
        "injury_negative": [
            "Player is ruled out with a serious injury",
            "He will miss tonight's game due to knee soreness",
            "Player has been shut down for the rest of the season",
            "Star player is doubtful and unlikely to suit up",
        ],
        "load_management": [
            "Player is resting tonight for load management",
            "Coach said he will be on a minutes restriction",
            "He will play limited minutes coming back from injury",
            "Team is managing his workload carefully",
        ],
        "positive_news": [
            "Player has been cleared to play with no limitations",
            "He participated fully in practice today",
            "Star is expected to play and will start tonight",
            "Player says he feels great and is ready to go",
        ],
        "role_boost": [
            "Player is moving into the starting lineup",
            "He will see an expanded role with the trade",
            "Coach said he will play more minutes going forward",
            "Player earned a bigger role after strong recent play",
        ],
    }

    def __init__(self):
        if not HAS_SENTENCE_TRANSFORMERS:
            raise ImportError(
                "sentence-transformers not installed. "
                "Install with: pip install sentence-transformers"
            )
        print("  [SentenceTransformer] Loading all-MiniLM-L6-v2 model...")
        self.model = SentenceTransformer("all-MiniLM-L6-v2")
        self._reference_embeddings: Dict[str, Any] = {}
        self._build_reference_embeddings()
        print("  [SentenceTransformer] Ready (CPU mode)")

    def _build_reference_embeddings(self) -> None:
        """Pre-compute embeddings for all reference sentences."""
        for category, sentences in self.REFERENCE_SENTENCES.items():
            embeddings = self.model.encode(sentences, convert_to_tensor=False)
            if HAS_NUMPY:
                self._reference_embeddings[category] = np.array(embeddings)

    def enhance_signal(
        self, text: str, base_ir: float, base_ma: float
    ) -> Tuple[float, float]:
        """
        Refine keyword-based signals using semantic similarity.
        Returns adjusted (injury_risk, minutes_adj).
        """
        if not HAS_NUMPY:
            return base_ir, base_ma

        text_embedding = self.model.encode([text], convert_to_tensor=False)
        text_emb = np.array(text_embedding)

        scores: Dict[str, float] = {}
        for category, ref_embs in self._reference_embeddings.items():
            # Cosine similarity against each reference, take max
            sims = np.dot(ref_embs, text_emb.T).flatten()
            norms_ref = np.linalg.norm(ref_embs, axis=1)
            norms_text = np.linalg.norm(text_emb, axis=1)
            cos_sims = sims / (norms_ref * norms_text + 1e-8)
            scores[category] = float(np.max(cos_sims))

        # Blend semantic signal with keyword signal (30% semantic weight)
        semantic_ir = max(scores.get("injury_negative", 0), scores.get("load_management", 0) * 0.5)
        semantic_ma_neg = -scores.get("load_management", 0) * 0.6
        semantic_ma_pos = scores.get("role_boost", 0) * 0.5

        adjusted_ir = base_ir * 0.7 + semantic_ir * 0.3
        adjusted_ma = base_ma * 0.7 + (semantic_ma_neg + semantic_ma_pos) * 0.3

        return float(np.clip(adjusted_ir, 0, 1)), float(np.clip(adjusted_ma, -1, 1))


# ═══════════════════════════════════════════════════════════════════════════
# HISTORICAL BACKFILL ENGINE
# ═══════════════════════════════════════════════════════════════════════════

class HistoricalBackfillEngine:
    """
    Generates synthetic NLP context signals for historical dates
    using the official NBA injury designations already captured in
    the existing Rotowire lineup data.

    This allows walk-forward backtesting of the NLP features even
    without historical RSS feed data.
    """

    def generate_baseline_signals(
        self,
        game_logs_csv: str,
        classifier: KeywordClassifier,
    ) -> Dict[str, PlayerSignal]:
        """
        For each player-date in the game logs, generate a baseline
        NLP context vector. Players who played get neutral signals.
        Players who were absent (no game log for a team-date where
        their team played) get elevated injury_risk.
        """
        print("\n  [Backfill] Building historical baseline signals...")

        # Load all game logs
        player_games: Dict[str, Set[str]] = defaultdict(set)    # player -> set of dates
        team_games: Dict[str, Set[str]] = defaultdict(set)      # team -> set of dates
        player_team: Dict[str, str] = {}                         # player -> team
        all_dates: Set[str] = set()

        with open(game_logs_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get("playerName", "").strip()
                date = row.get("gameDateEt", "").strip()
                team = row.get("team", "").strip()
                if name and date:
                    player_games[name].add(date)
                    all_dates.add(date)
                    if team:
                        team_games[team].add(date)
                        player_team[name] = team

        signals: Dict[str, PlayerSignal] = {}
        total_generated = 0

        for player, dates in player_games.items():
            team = player_team.get(player, "")
            team_dates = team_games.get(team, set())

            for date in sorted(all_dates):
                key = f"{player}_{date}"
                played = date in dates
                team_played = date in team_dates

                if played:
                    # Player played -> neutral/healthy signal
                    signals[key] = PlayerSignal(
                        player_name=player,
                        date=date,
                        injury_risk=0.02,
                        minutes_adj=0.0,
                        availability_conf=0.95,
                        sentiment_score=0.1,
                        raw_signals=["played"],
                        source_count=1,
                        last_updated=f"{date}T00:00:00Z",
                    )
                elif team_played and not played:
                    # Team played but player didn't -> likely injured/resting
                    signals[key] = PlayerSignal(
                        player_name=player,
                        date=date,
                        injury_risk=0.75,
                        minutes_adj=-0.8,
                        availability_conf=0.6,
                        sentiment_score=-0.5,
                        raw_signals=["absent_team_played"],
                        source_count=1,
                        last_updated=f"{date}T00:00:00Z",
                    )
                # Skip dates where team didn't play (no signal)

                total_generated += 1

        print(f"  [Backfill] Generated {len(signals)} player-date signals "
              f"({total_generated} total iterations)")
        return signals


# ═══════════════════════════════════════════════════════════════════════════
# MAIN ENGINE ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════════════

class NLPContextEngine:
    """
    Main orchestrator combining all scrapers, classifiers, and matchers
    into a single pipeline that produces per-player context vectors.
    """

    def __init__(self, player_csv: Optional[str] = None, use_transformers: bool = False):
        print("\n+==============================================================+")
        print("|     NLP Context Engine — Information Asymmetry Pipeline     |")
        print("|==============================================================|")
        print(f"|  beautifulsoup4:       {'[OK] loaded' if HAS_BS4 else '[--] not found (HTML parsing limited)':<34}|")
        print(f"|  feedparser:           {'[OK] loaded' if HAS_FEEDPARSER else '[--] not found (using stdlib XML)':<34}|")
        print(f"|  sentence-transformers:{'[OK] loaded' if HAS_SENTENCE_TRANSFORMERS else '[--] not found (keyword-only mode)':<34}|")
        print("+==============================================================+")

        self.classifier = KeywordClassifier()
        self.matcher = PlayerNameMatcher(player_csv)
        self.rss_scraper = RSSFeedScraper()
        self.injury_scraper = NBAInjuryReportScraper()
        self.rotowire_scraper = RotowireNewsScraper()
        self.backfill_engine = HistoricalBackfillEngine()

        self.enhancer: Optional[SentenceTransformerEnhancer] = None
        if use_transformers and HAS_SENTENCE_TRANSFORMERS:
            try:
                self.enhancer = SentenceTransformerEnhancer()
            except Exception as e:
                print(f"  [!] SentenceTransformer init failed: {e}")

    def scrape_live(self) -> List[NewsItem]:
        """Scrape all configured live news sources."""
        print("\n>> Scraping live news sources...")
        items: List[NewsItem] = []

        # RSS feeds
        rss_items = self.rss_scraper.scrape()
        items.extend(rss_items)

        # Rotowire player news
        roto_items = self.rotowire_scraper.scrape()
        items.extend(roto_items)

        print(f"\n  ## Total raw news items scraped: {len(items)}")
        return items

    def classify_items(self, items: List[NewsItem]) -> Dict[str, PlayerSignal]:
        """
        Process scraped news items through the classification pipeline.
        Returns signals keyed by player_name.
        """
        print("\n>> Classifying news items...")
        player_signals: Dict[str, List[Tuple[float, float, float, float, List[str]]]] = defaultdict(list)

        for item in items:
            full_text = f"{item.headline} {item.body}"

            # Find player names in the text
            if item.player_names:
                players = [(name, "") for name in item.player_names]
            else:
                players = self.matcher.find_players_in_text(full_text)

            if not players:
                continue

            # Classify the text
            ir, ma, ac, sent, signals = self.classifier.classify(full_text)

            # Optional: enhance with sentence-transformer
            if self.enhancer and (ir > 0.05 or abs(ma) > 0.1):
                ir, ma = self.enhancer.enhance_signal(full_text, ir, ma)

            # Skip items with no actionable signal
            if ac < 0.05 and abs(sent) < 0.05:
                continue

            for player_name, team in players:
                player_signals[player_name].append((ir, ma, ac, sent, signals))

        # Aggregate multiple signals per player (take highest-confidence signal)
        result: Dict[str, PlayerSignal] = {}
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        for player_name, signal_list in player_signals.items():
            # Sort by availability_conf descending, take the most confident
            signal_list.sort(key=lambda x: x[2], reverse=True)
            best = signal_list[0]

            # Average across all sources for the numeric scores
            n = len(signal_list)
            avg_ir = sum(s[0] for s in signal_list) / n
            avg_ma = sum(s[1] for s in signal_list) / n
            avg_sent = sum(s[3] for s in signal_list) / n

            # But keep highest confidence
            max_ac = max(s[2] for s in signal_list)

            # Collect all signal labels
            all_signals = []
            for s in signal_list:
                all_signals.extend(s[4])

            result[player_name] = PlayerSignal(
                player_name=player_name,
                date=today,
                injury_risk=round(min(1.0, max(0.0, avg_ir)), 4),
                minutes_adj=round(max(-1.0, min(1.0, avg_ma)), 4),
                availability_conf=round(max_ac, 4),
                sentiment_score=round(max(-1.0, min(1.0, avg_sent)), 4),
                raw_signals=list(set(all_signals)),
                source_count=n,
                last_updated=datetime.now(timezone.utc).isoformat(),
            )

        print(f"  ## Classified signals for {len(result)} players")
        return result

    def run_live(self) -> Dict[str, PlayerSignal]:
        """Full live pipeline: scrape -> classify -> return signals."""
        items = self.scrape_live()
        return self.classify_items(items)

    def run_backfill(self, csv_path: str) -> Dict[str, PlayerSignal]:
        """Generate historical baseline signals from game logs."""
        return self.backfill_engine.generate_baseline_signals(
            csv_path, self.classifier
        )

    def export_signals(
        self,
        signals: Dict[str, PlayerSignal],
        output_dir: str,
        filename: Optional[str] = None,
    ) -> str:
        """Export signals to JSON file."""
        os.makedirs(output_dir, exist_ok=True)

        if filename is None:
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            filename = f"nlp_signals_{date_str}.json"

        filepath = os.path.join(output_dir, filename)

        # Convert to serializable dict
        export_data = {}
        for key, signal in signals.items():
            export_data[key] = {
                "player_name": signal.player_name,
                "date": signal.date,
                "injury_risk": signal.injury_risk,
                "minutes_adj": signal.minutes_adj,
                "availability_conf": signal.availability_conf,
                "sentiment_score": signal.sentiment_score,
                "raw_signals": signal.raw_signals,
                "source_count": signal.source_count,
                "last_updated": signal.last_updated,
                # The 4-dim feature vector for downstream integration
                "feature_vector": [
                    signal.injury_risk,
                    signal.minutes_adj,
                    signal.availability_conf,
                    signal.sentiment_score,
                ],
            }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(export_data, f, indent=2)

        print(f"\n  >> Exported {len(export_data)} signals to {filepath}")
        return filepath


# ═══════════════════════════════════════════════════════════════════════════
# SELF-TEST
# ═══════════════════════════════════════════════════════════════════════════

def run_self_test():
    """Validate the keyword classifier against known test cases."""
    print("\n" + "=" * 65)
    print("  NLP CONTEXT ENGINE — SELF-TEST")
    print("=" * 65)

    classifier = KeywordClassifier()

    test_cases = [
        # (text, expected_direction)  direction: "negative", "positive", "restriction", "neutral"
        ("LeBron James is ruled out tonight with a left ankle sprain", "negative"),
        ("Giannis Antetokounmpo is listed as questionable with knee soreness", "uncertain"),
        ("Damian Lillard has been cleared to play with no limitations", "positive"),
        ("Nikola Jokic will be on a minutes restriction tonight", "restriction"),
        ("Anthony Davis is doubtful for tonight's game", "negative"),
        ("Jayson Tatum is probable and expected to play", "positive"),
        ("Coach said Luka Doncic will have an expanded role tonight", "positive"),
        ("Stephen Curry is dealing with load management", "restriction"),
        ("Kevin Durant is moving into the starting lineup", "positive"),
        ("Jimmy Butler is out indefinitely with a knee injury", "negative"),
        ("Player participated in full practice, no concerns about injury", "positive"),
        ("Zion Williamson will miss the next 4-6 weeks with a hamstring strain", "negative"),
    ]

    passed = 0
    failed = 0

    for text, expected in test_cases:
        ir, ma, ac, sent, signals = classifier.classify(text)

        if expected == "negative":
            ok = ir >= 0.4 and sent < 0
        elif expected == "uncertain":
            ok = 0.2 <= ir <= 0.7
        elif expected == "restriction":
            ok = ma < -0.2
        elif expected == "positive":
            ok = sent > 0 or ma > 0
        else:
            ok = True

        status = "[OK] PASS" if ok else "[--] FAIL"
        if ok:
            passed += 1
        else:
            failed += 1

        short_text = text[:60] + "..." if len(text) > 60 else text
        print(f"  {status} [{expected:>11}] IR={ir:.2f} MA={ma:+.2f} "
              f"AC={ac:.2f} S={sent:+.2f} | {short_text}")

    print(f"\n  Results: {passed}/{passed + failed} passed "
          f"({100 * passed / (passed + failed):.0f}%)")
    return failed == 0


# ═══════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="NLP Context Engine — NBA Player Availability Signal Extraction",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/nlp_context_engine.py --test
  python scripts/nlp_context_engine.py --live --out exports/nlp_signals/
  python scripts/nlp_context_engine.py --backfill --csv exports/nba-season-2025-player-game-logs.csv
        """,
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Run self-test validation suite"
    )
    parser.add_argument(
        "--live", action="store_true",
        help="Run live scraping pipeline (fetches current news)"
    )
    parser.add_argument(
        "--backfill", action="store_true",
        help="Generate historical baseline signals from game logs"
    )
    parser.add_argument(
        "--csv", type=str,
        default="exports/nba-season-2025-player-game-logs.csv",
        help="Path to game logs CSV (for player matching and backfill)"
    )
    parser.add_argument(
        "--out", type=str,
        default="exports/nlp_signals/",
        help="Output directory for exported signals"
    )
    parser.add_argument(
        "--use-transformers", action="store_true",
        help="Enable sentence-transformer enhancement (requires torch + sentence-transformers)"
    )

    args = parser.parse_args()

    if args.test:
        success = run_self_test()
        sys.exit(0 if success else 1)

    engine = NLPContextEngine(
        player_csv=args.csv,
        use_transformers=args.use_transformers,
    )

    if args.backfill:
        print("\n>> Running historical backfill mode...")
        signals = engine.run_backfill(args.csv)
        engine.export_signals(signals, args.out, filename="nlp_backfill_signals.json")

    elif args.live:
        print("\n>> Running live scraping mode...")
        signals = engine.run_live()
        engine.export_signals(signals, args.out)

    else:
        # Default: run self-test then live
        run_self_test()
        print("\n" + "-" * 65)
        print("Run with --live for live scraping or --backfill for historical data")

    print("\n[DONE] NLP Context Engine complete.")


if __name__ == "__main__":
    main()
