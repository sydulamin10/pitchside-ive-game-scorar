"""Director state for the live overlay: design, corner brand, sponsor."""

from app.services.overlay_director import _normalise, put


def test_default_is_name_mode_with_circle_design():
    out = _normalise(None)
    assert out["design"] == "circle"
    assert out["brand_mode"] == "name"
    assert out["panel"] == "hidden"
    assert out["sponsor_on"] is False


def test_old_show_tournament_false_hides_the_corner():
    out = _normalise({"show_tournament": False, "panel": "scorecard"})
    assert out["brand_mode"] == "none"
    assert out["show_tournament"] is False
    assert out["panel"] == "scorecard"


def test_logo_mode_keeps_a_custom_url():
    out = _normalise(
        {
            "brand_mode": "logo",
            "brand_logo_url": "https://cdn.example/logo.png",
            "sponsor_logo_url": "https://cdn.example/sponsor.png",
            "sponsor_on": True,
            "design": "classic",
        }
    )
    assert out["brand_mode"] == "logo"
    assert out["show_tournament"] is True
    assert out["design"] == "classic"
    assert out["sponsor_on"] is True
    assert "sponsor.png" in out["sponsor_logo_url"]


def test_unknown_design_falls_back_to_circle():
    assert _normalise({"design": "neon"})["design"] == "circle"


async def test_put_maps_show_tournament_without_brand_mode(monkeypatch):
    async def missing(_kind: str, _match_id: str):
        return None

    async def noop_set(*_args, **_kwargs):
        return None

    monkeypatch.setattr("app.services.overlay_director.state_cache.get_json", missing)
    monkeypatch.setattr("app.services.overlay_director.state_cache.set_json", noop_set)
    from app.services import overlay_director as director

    director._memory.pop("match-1", None)
    out = await put("match-1", {"show_tournament": False, "design": "split"})
    assert out["brand_mode"] == "none"
    assert out["design"] == "split"
