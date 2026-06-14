# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import typing


@allow_storage
@dataclass
class Market:
    question: str
    yes_condition: str
    no_condition: str
    invalid_condition: str
    resolution_url: str        # v1: single authoritative source per market
    resolution_query: str
    deadline: u256             # Unix timestamp (seconds)
    yes_pool: u256
    no_pool: u256
    status: str                # OPEN | LOCKED | RESOLVED | INVALID | UNRESOLVED | CANCELLED
    outcome: str               # "" | "YES" | "NO"
    confidence: str            # "" | "HIGH" | "MEDIUM" | "LOW" — set after consensus
    resolution_note: str       # deterministic label set post-consensus, never inside strict_eq
    resolved_at: str           # ISO 8601 timestamp
    creator: str               # address string


@allow_storage
@dataclass
class Position:
    yes_stake: u256
    no_stake: u256
    claimed: bool              # prevents double-claim and double-refund


# Ghost contract interface for sending GEN to EOAs and EVM contracts.
# Empty View/Write classes are the documented pattern — "will be simplified in a future version."
# emit_transfer on this interface always executes at finalization (external message).
@gl.evm.contract_interface
class _EOARecipient:
    class View:
        pass

    class Write:
        pass


class KarionMarket(gl.Contract):
    owner: str
    markets: TreeMap[str, Market]
    positions: TreeMap[str, Position]   # flat key: "{market_id}::{user_address}"

    def __init__(self) -> None:
        self.owner = str(gl.message.sender_address)

    # ── internal helpers ─────────────────────────────────────────────────────

    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())

    def _pos_key(self, market_id: str, user: str) -> str:
        return f"{market_id}::{user}"

    def _require_market(self, market_id: str) -> Market:
        if market_id not in self.markets:
            raise Exception(f"Market not found: {market_id}")
        return self.markets[market_id]

    # ── owner: create / cancel ────────────────────────────────────────────────

    @gl.public.write
    def create_market(
        self,
        market_id: str,
        question: str,
        yes_condition: str,
        no_condition: str,
        invalid_condition: str,
        resolution_url: str,
        resolution_query: str,
        deadline: int,
    ) -> None:
        assert str(gl.message.sender_address) == self.owner, "Owner only"
        assert market_id not in self.markets, "Market ID already exists"

        # Length limits — prevent storage bloat and unstable prompts
        assert 1 <= len(market_id) <= 64, "market_id must be 1–64 chars"
        assert 1 <= len(question) <= 512, "question must be 1–512 chars"
        assert 1 <= len(yes_condition) <= 256, "yes_condition must be 1–256 chars"
        assert 1 <= len(no_condition) <= 256, "no_condition must be 1–256 chars"
        assert 1 <= len(invalid_condition) <= 256, "invalid_condition must be 1–256 chars"
        assert 1 <= len(resolution_url) <= 512, "resolution_url must be 1–512 chars"
        assert 1 <= len(resolution_query) <= 512, "resolution_query must be 1–512 chars"

        assert deadline > self._now(), "Deadline must be in the future"

        self.markets[market_id] = Market(
            question=question,
            yes_condition=yes_condition,
            no_condition=no_condition,
            invalid_condition=invalid_condition,
            resolution_url=resolution_url,
            resolution_query=resolution_query,
            deadline=u256(deadline),
            yes_pool=u256(0),
            no_pool=u256(0),
            status="OPEN",
            outcome="",
            confidence="",
            resolution_note="",
            resolved_at="",
            creator=str(gl.message.sender_address),
        )

    @gl.public.write
    def cancel_market(self, market_id: str) -> None:
        # CENTRALIZATION RISK (v1): the owner can cancel a market with active stakes.
        # CANCELLED moves to a refundable state — all stakers can recover their principal
        # via claim_refund. However, a malicious owner could cancel a market they are
        # losing. Stage 4 should add a timelock or DAO-governed cancellation path.
        market = self._require_market(market_id)
        assert str(gl.message.sender_address) == self.owner, "Owner only"
        assert market.status in ("OPEN", "LOCKED"), f"Cannot cancel: {market.status}"
        market.status = "CANCELLED"
        self.markets[market_id] = market

    # ── staking ───────────────────────────────────────────────────────────────
    # One account may stake both YES and NO (portfolio hedging is a valid use case).
    # yes_stake and no_stake accumulate independently; only the winning side is paid
    # out from claim_payout. Losing stake funds the winners' proportional payout.

    @gl.public.write.payable
    def stake_yes(self, market_id: str) -> None:
        market = self._require_market(market_id)
        assert market.status == "OPEN", f"Not OPEN: {market.status}"
        assert self._now() < int(market.deadline), "Staking deadline passed"
        v = gl.message.value
        assert v > u256(0), "Zero stake rejected"
        caller = str(gl.message.sender_address)
        key = self._pos_key(market_id, caller)
        pos = self.positions.get(key, Position(u256(0), u256(0), False))
        pos.yes_stake = pos.yes_stake + v
        self.positions[key] = pos
        market.yes_pool = market.yes_pool + v
        self.markets[market_id] = market

    @gl.public.write.payable
    def stake_no(self, market_id: str) -> None:
        market = self._require_market(market_id)
        assert market.status == "OPEN", f"Not OPEN: {market.status}"
        assert self._now() < int(market.deadline), "Staking deadline passed"
        v = gl.message.value
        assert v > u256(0), "Zero stake rejected"
        caller = str(gl.message.sender_address)
        key = self._pos_key(market_id, caller)
        pos = self.positions.get(key, Position(u256(0), u256(0), False))
        pos.no_stake = pos.no_stake + v
        self.positions[key] = pos
        market.no_pool = market.no_pool + v
        self.markets[market_id] = market

    # ── lifecycle ─────────────────────────────────────────────────────────────

    @gl.public.write
    def lock_market(self, market_id: str) -> None:
        market = self._require_market(market_id)
        assert market.status == "OPEN", f"Not OPEN: {market.status}"
        assert self._now() >= int(market.deadline), "Deadline not yet passed"
        market.status = "LOCKED"
        self.markets[market_id] = market

    @gl.public.write
    def resolve_market(self, market_id: str) -> None:
        market = self._require_market(market_id)
        # Auto-transition OPEN → LOCKED if deadline passed (saves a round-trip tx)
        if market.status == "OPEN" and self._now() >= int(market.deadline):
            market.status = "LOCKED"
        assert market.status == "LOCKED", f"Not LOCKED: {market.status}"

        # Capture fields into locals for use inside the nondet closure
        resolution_url = market.resolution_url
        question = market.question
        yes_cond = market.yes_condition
        no_cond = market.no_condition
        invalid_cond = market.invalid_condition
        resolution_query = market.resolution_query

        def nondet() -> str:
            response = gl.nondet.web.get(resolution_url)
            body = response.body
            # gl.nondet.web.get may return bytes OR str depending on the server response
            if isinstance(body, bytes):
                web_data = body.decode("utf-8", errors="replace")
            else:
                web_data = str(body)
            web_data = web_data[:6000]   # truncate to keep prompt deterministic in length

            prompt = f"""You are resolving a prediction market. Use ONLY the web evidence below.

Question: {question}
YES if: {yes_cond}
NO if: {no_cond}
INVALID if: {invalid_cond}
Resolution task: {resolution_query}

Web evidence from {resolution_url}:
---
{web_data}
---

Rules:
- Respond ONLY with a JSON object on a single line. No markdown, no extra text.
- "outcome" must be exactly one of: "YES", "NO", "INVALID", "UNRESOLVED"
- "confidence" must be exactly one of: "HIGH", "MEDIUM", "LOW"
- Use "UNRESOLVED" only when the evidence does not contain enough information.
- Use "INVALID" only when the INVALID condition above is explicitly and clearly met.
- Base your answer solely on the evidence text — do not use general knowledge.

JSON:
{{"outcome": "YES|NO|INVALID|UNRESOLVED", "confidence": "HIGH|MEDIUM|LOW"}}"""

            raw = (
                gl.nondet.exec_prompt(prompt)
                .replace("```json", "")
                .replace("```", "")
                .strip()
            )
            parsed = json.loads(raw)
            assert parsed["outcome"] in ("YES", "NO", "INVALID", "UNRESOLVED"), \
                f"Invalid outcome: {parsed.get('outcome')}"
            assert parsed["confidence"] in ("HIGH", "MEDIUM", "LOW"), \
                f"Invalid confidence: {parsed.get('confidence')}"

            # Only categorical enum fields pass through strict equality.
            # No free-form text — validators must agree on the exact same string.
            return json.dumps(
                {"confidence": parsed["confidence"], "outcome": parsed["outcome"]},
                sort_keys=True,
            )

        result = json.loads(gl.eq_principle.strict_eq(nondet))
        outcome = result["outcome"]
        confidence = result["confidence"]

        # Everything below is deterministic — set after consensus, never inside strict_eq.
        market.outcome = outcome if outcome in ("YES", "NO") else ""
        market.confidence = confidence
        market.resolution_note = f"GenLayer consensus: {outcome} [{confidence}]"
        market.resolved_at = datetime.now(timezone.utc).isoformat()
        market.status = "RESOLVED" if outcome in ("YES", "NO") else outcome
        self.markets[market_id] = market

    # ── claims ────────────────────────────────────────────────────────────────
    # Both claim methods follow Checks-Effects-Interactions (CEI):
    #   1. Check guards (not claimed, status, stake > 0)
    #   2. Effect: mark claimed = True, write position
    #   3. Interact: emit_transfer (queued external message, executes at finalization)
    #
    # Setting claimed=True before emit_transfer prevents re-entrancy.
    # An exception at any step before emit_transfer fully reverts state (GenVM guarantee).
    # EOA native-value transfers cannot fail at the EVM layer, so the
    # "child tx fails → value not returned" risk from the docs does not apply here.
    #
    # DUST: integer pro-rata division may leave 1–N wei in the contract per market
    # (at most yes_winner_count - 1 wei). This is standard in integer-arithmetic DeFi.

    @gl.public.write
    def claim_payout(self, market_id: str) -> None:
        market = self._require_market(market_id)
        assert market.status == "RESOLVED", f"Not RESOLVED: {market.status}"
        caller = str(gl.message.sender_address)
        key = self._pos_key(market_id, caller)
        pos = self.positions.get(key, Position(u256(0), u256(0), False))
        assert not pos.claimed, "Already claimed"
        total_pool = market.yes_pool + market.no_pool
        assert total_pool > u256(0), "Empty pool"
        if market.outcome == "YES":
            assert pos.yes_stake > u256(0), "No YES stake"
            assert market.yes_pool > u256(0), "Empty YES pool"
            payout = (pos.yes_stake * total_pool) // market.yes_pool
        elif market.outcome == "NO":
            assert pos.no_stake > u256(0), "No NO stake"
            assert market.no_pool > u256(0), "Empty NO pool"
            payout = (pos.no_stake * total_pool) // market.no_pool
        else:
            raise Exception("Use claim_refund for this outcome")
        assert payout > u256(0), "Zero payout"
        pos.claimed = True                      # CEI: effect before interact
        self.positions[key] = pos
        _EOARecipient(Address(caller)).emit_transfer(value=payout)

    @gl.public.write
    def claim_refund(self, market_id: str) -> None:
        market = self._require_market(market_id)
        assert market.status in ("INVALID", "UNRESOLVED", "CANCELLED"), \
            f"No refund available: {market.status}"
        caller = str(gl.message.sender_address)
        key = self._pos_key(market_id, caller)
        pos = self.positions.get(key, Position(u256(0), u256(0), False))
        assert not pos.claimed, "Already claimed"
        refund = pos.yes_stake + pos.no_stake
        assert refund > u256(0), "No stake to refund"
        pos.claimed = True                      # CEI: effect before interact
        self.positions[key] = pos
        _EOARecipient(Address(caller)).emit_transfer(value=refund)

    # ── views ─────────────────────────────────────────────────────────────────

    @gl.public.view
    def get_market(self, market_id: str) -> typing.Any:
        market = self._require_market(market_id)
        return {
            "question": market.question,
            "yes_condition": market.yes_condition,
            "no_condition": market.no_condition,
            "invalid_condition": market.invalid_condition,
            "resolution_url": market.resolution_url,
            "resolution_query": market.resolution_query,
            "deadline": int(market.deadline),
            "yes_pool": int(market.yes_pool),
            "no_pool": int(market.no_pool),
            "status": market.status,
            "outcome": market.outcome,
            "confidence": market.confidence,
            "resolution_note": market.resolution_note,
            "resolved_at": market.resolved_at,
            "creator": market.creator,
        }

    @gl.public.view
    def get_position(self, market_id: str, user: str) -> typing.Any:
        key = self._pos_key(market_id, user)
        pos = self.positions.get(key, Position(u256(0), u256(0), False))
        return {
            "yes_stake": int(pos.yes_stake),
            "no_stake": int(pos.no_stake),
            "claimed": pos.claimed,
        }
