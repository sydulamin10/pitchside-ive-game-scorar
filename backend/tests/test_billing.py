"""Account approval, coupons, and pricing-page plan quotes."""

from decimal import Decimal
from types import SimpleNamespace

from app.models.enums import BillingPlan, CouponDiscountType, PaymentStatus
from app.services.billing_service import GRANDFATHER_NOTE, _counts_for_entitlement, quote
from app.services.overlay_director import MAX_SPONSORS, _normalise


def test_live_match_member_and_coupon_stack():
    priced = quote(plan=BillingPlan.LIVE_MATCH, quantity=2, member_discount=True)
    assert priced["list_amount"] == Decimal("1.80")
    assert priced["live_credits"] == 2

    class _Coupon:
        code = "HALF"
        discount_type = CouponDiscountType.PERCENT
        discount_value = Decimal("50")

    cut = quote(plan=BillingPlan.LIVE_MATCH, quantity=1, coupon=_Coupon())
    assert cut["paid_amount"] == Decimal("0.60")
    assert cut["discount_amount"] == Decimal("0.60")


def test_pro_and_tournament_catalog_prices():
    pro = quote(plan=BillingPlan.PRO, quantity=1)
    assert pro["paid_amount"] == Decimal("9.99")
    assert pro["period_days"] == 30
    cup = quote(plan=BillingPlan.TOURNAMENT, quantity=1)
    assert cup["paid_amount"] == Decimal("15.99")


def test_sponsor_cap_is_six():
    assert MAX_SPONSORS == 6
    out = _normalise(
        {
            "sponsors": [
                {"id": str(i), "url": f"https://cdn.example/{i}.png", "on": True} for i in range(10)
            ]
        }
    )
    assert len(out["sponsors"]) == 6


def test_expired_end_summary_hides():
    out = _normalise({"panel": "summary", "summary_until": "2000-01-01T00:00:00+00:00"})
    assert out["panel"] == "hidden"
    assert out["summary_until"] == ""


def test_grandfathered_payments_do_not_count():
    paid = SimpleNamespace(note=GRANDFATHER_NOTE, status=PaymentStatus.PAID)
    granted = SimpleNamespace(note="Admin credit grant", status=PaymentStatus.PAID)
    assert _counts_for_entitlement(paid) is False
    assert _counts_for_entitlement(granted) is True


def test_credit_grant_schema_modes():
    from app.schemas.billing import CreditGrant

    add = CreditGrant(credits=3)
    assert add.mode == "add"
    set_to = CreditGrant(credits=5, mode="set")
    assert set_to.mode == "set"
    assert set_to.credits == 5


def test_audit_constraint_covers_billing_actions():
    from pathlib import Path

    from app.models.enums import AuditAction

    source = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260922_2025_billing_audit.py"
    ).read_text(encoding="utf-8")
    for action in AuditAction:
        assert f'"{action.value}"' in source

