"""What may be fitted to a weapon, read out of two games that agree about nothing.

Both readings are the sort that fails quietly. IW5 writes an unused scale as 0,
so read as a multiplier it takes a weapon's numbers to nothing; four of its
attachments carry a whole second weapon's stats, which folded onto the host make
a plausible four-round M4. IW4 says the same things only by difference, and two
of those differences do not compose the obvious way.

The last test is the one that matters: MW2 ships the answers. Composing two
single-attachment deltas has to reproduce the weapon file the game itself ships
for that pair, for all 806 pairs. It needs the MW2 companion zone dumped, and
skips without it.
"""

import os

import pytest

from scripts.cod.attachments import (
    ATTACH_DIR,
    IW4_TYPES,
    MAX_ATTACHMENT_SLOTS,
    accepted,
    check_variants,
    compose,
    derived_tag,
    iw4_entries,
    iw4_entry,
    iw5_entry,
    iw5_roles,
    read_defs,
    resolve_clips,
    resolve_mounts,
    restrict_bones,
    scale,
    sort_key,
    spec_of,
    split_variants,
)
from scripts.cod.files import read_text
from scripts.cod.viewmodel import ballistics, parse_infostring

MW2_DUMP = ".cache/cod/catalog-mw2"
# Wherever MW3's attachment assets were last dumped: the `catalog --dump mw3`
# default, or an export's scratch directory that was kept. A scratch directory is
# deleted after an export, so this names more than one rather than skipping
# whenever the last export happened to clean up after itself.
MW3_DUMPS = (".cache/cod/catalog-mw3", ".cache/cod/attach-mw3", ".cache/cod/dome-mw3")


def mw3_dump():
    """The first dump that holds the attachment assets, or None."""
    return next((work for work in MW3_DUMPS if os.path.isdir(os.path.join(work, ATTACH_DIR, "attachment"))), None)


def attach(**kw):
    """An IW5 attachment asset, with the fields every one of the 40 carries."""
    base = {
        "type": "other",
        "weapClass": "rifle",
        "displayName": "WEAPON_X_ATTACHMENT",
        "adsSettingsScale": 0.0,
        "ammunitionScale": 0.0,
        "damageScale": 0.0,
        "fireTimersScale": 1.0,
        "gunKickScale": 0.0,
        "hipSpreadScale": 0.0,
        "idleSettingsScale": 0.0,
        "stateTimersScale": 1.0,
        "viewKickScale": 0.0,
        "hideIronSightsWithThisAttachment": False,
        "viewModels": [],
        "worldModels": [],
    }
    return {**base, **kw}


def weapon(**kw):
    """A weapon file as `parse_infostring` gives it: strings, not numbers."""
    base = {
        "clipSize": "30",
        "fireType": "Full Auto",
        "adsZoomFov": "50",
        "fireTime": "0.075",
        "reloadTime": "2.0",
        "idleAnim": "viewmodel_M4_idle",
        "reloadAnim": "viewmodel_M4_reload",
        "adsUpAnim": "viewmodel_M4_ADS_up",
        "hipIdleAmount": "15",
    }
    return {**base, **kw}


# --- IW5 ----------------------------------------------------------------------


def test_an_unused_scale_is_written_as_zero_not_one():
    """The trap: read literally, `gunKickScale: 0` multiplies a weapon's recoil away."""
    assert scale(attach(), "gunKickScale") is None
    assert scale(attach(), "fireTimersScale") is None
    assert scale(attach(ammunitionScale=1.5), "ammunitionScale") == 1.5


def test_a_scale_is_collapsed_against_this_weapons_own_numbers():
    """Extended mags are 1.5x, and the engine is told 45 rather than the factor."""
    entry = iw5_entry("xmags", attach(ammunitionScale=1.5), spec_of(weapon()))
    assert entry["overrides"]["clipSize"] == 45
    assert iw5_entry("rof", attach(fireTimersScale=0.8), spec_of(weapon()))["overrides"]["times"]["fire"] == pytest.approx(0.06)


def test_a_scope_replaces_the_ads_zoom_and_the_transitions_it_names():
    ads = {"adsZoomFov": 30.0, "adsTransInTime": 0.38, "adsTransOutTime": 0.38}
    entry = iw5_entry("acog", attach(type="scope", adsSettings=ads), spec_of(weapon()))
    assert entry["overrides"]["adsZoomFov"] == 30.0
    assert entry["overrides"]["times"] == {"adsIn": 0.38, "adsOut": 0.38}
    # Only what it names: the weapon's own reload survives being aimed through.
    assert "reload" not in entry["overrides"]["times"]


def test_a_fire_selector_changes_how_the_gun_fires():
    """Ghosts sells the selector as an attachment, and its `ammoGeneral` is the only thing that says so."""
    single = attach(ammoGeneral={"fireType": "Single Shot"}, fireTimersScale=1.3)
    assert iw5_entry("firetypesingle", single, spec_of(weapon()))["overrides"]["fireType"] == "Single Shot"
    # Slug rounds carry the same block; on a shotgun that already fires one shot a press it says nothing.
    same = spec_of(weapon(fireType="Single Shot"))
    assert "fireType" not in iw5_entry("ammoslug", single, same).get("overrides", {})


def test_an_underbarrel_weapons_own_stats_are_not_folded_onto_the_gun():
    """`shotgun`, `gl`, `gp25` and `m320` carry a second weapon, not a change to this one."""
    m203 = attach(
        type="underbarrel",
        ammunition={"clipSize": 1},
        ammunitionScale=1.0,
        adsSettings={"adsZoomFov": 80.0, "adsTransInTime": 0.5},
        ammoGeneral={"fireType": "singleshot"},
    )
    entry = iw5_entry("gl", m203, spec_of(weapon()))
    assert "overrides" not in entry


def test_an_optic_that_hides_the_iron_sights_says_which_joint():
    entry = iw5_entry("hybrid", attach(type="underbarrel", hideIronSightsWithThisAttachment=True), spec_of(weapon()))
    assert entry["hideBones"] == ["tag_sight_on"]


def test_a_weapon_lists_the_attachments_it_accepts_newline_separated():
    assert accepted({"attachments": "acog\neotech\nxmags"}) == ["acog", "eotech", "xmags"]
    assert accepted({}) == []


# --- IW4 ----------------------------------------------------------------------


def test_a_variant_is_the_base_name_plus_its_attachment_tokens():
    names = ["aa12_mp", "aa12_eotech_mp", "aa12_eotech_grip_mp", "ak47_mp"]
    assert split_variants("aa12_mp", names) == {"aa12_eotech_mp": ["eotech"], "aa12_eotech_grip_mp": ["eotech", "grip"]}


def test_an_attachment_is_the_difference_between_a_variant_and_its_base():
    base = spec_of(weapon(hideTags="tag_silencer\ntag_red_dot"))
    variant = spec_of(weapon(hideTags="tag_silencer", adsZoomFov="45", adsUpAnim="viewmodel_M4_EOTECH_ADS_up"))
    entry = iw4_entry("eotech", base, variant)
    assert entry["type"] == "scope"
    assert entry["overrides"]["adsZoomFov"] == 45.0
    assert entry["overrides"]["roles"] == {"adsUp": "viewmodel_M4_EOTECH_ADS_up"}
    # The gun carries every attachment's mesh and hides what is not fitted, so
    # fitting one *reveals* a joint. As text the second attachment's hideTags
    # would put the first's back; as a set, each drops its own.
    assert entry["showBones"] == ["tag_red_dot"]
    assert "hideBones" not in entry


def test_the_name_of_a_combination_is_not_either_attachments_name():
    """A two-attachment weapon file calls itself `WEAPON_AA12_BLING`, which describes neither."""
    base = spec_of(weapon())
    assert "displayName" not in iw4_entry("grip", base, spec_of(weapon(displayName="WEAPON_AA12_BLING")))


def test_only_the_single_attachment_variants_are_read():
    guns = {
        "aa12_eotech_mp": weapon(adsZoomFov="45"),
        "aa12_grip_mp": weapon(reloadTime="2.5"),
        "aa12_eotech_grip_mp": weapon(adsZoomFov="45", reloadTime="2.5"),
    }
    entries = iw4_entries("aa12_mp", weapon(), guns)
    assert [e["id"] for e in entries] == ["eotech", "grip"]


# --- The composition rule -----------------------------------------------------


def test_slot_order_is_by_type_so_a_grip_settles_a_field_an_optic_also_touches():
    entries = [{"id": "grip", "type": "underbarrel"}, {"id": "acog", "type": "scope"}, {"id": "fmj", "type": "other"}]
    assert [e["id"] for e in sorted(entries, key=sort_key)] == ["fmj", "acog", "grip"]


def test_a_fitted_optic_keeps_the_aiming_clips_and_the_grip_everything_else():
    base = spec_of(weapon())
    optic = iw4_entry("reflex", base, spec_of(weapon(adsUpAnim="optic_up", reloadAnim="optic_reload")))
    grip = iw4_entry("grip", base, spec_of(weapon(adsUpAnim="grip_up", reloadAnim="grip_reload")))
    both = compose(base, sorted([optic, grip], key=sort_key))
    assert both["roles"]["adsUp"] == "optic_up"
    assert both["roles"]["reload"] == "grip_reload"


def test_the_wire_caps_how_many_one_weapon_may_offer():
    """MW3's longest list is 11. Past 16 the catalogue is one `WeaponRegistry` refuses whole."""
    assert MAX_ATTACHMENT_SLOTS == 16


# --- Finishing an entry against a rig -----------------------------------------


def test_clip_names_take_the_zones_spelling_and_a_missing_one_is_dropped():
    entries = [{"id": "grip", "overrides": {"roles": {"reload": "viewmodel_M4_grip_reload", "idle": "not_dumped"}}}]
    assert resolve_clips(entries, ["viewmodel_m4_grip_reload"]) == {"viewmodel_m4_grip_reload"}
    assert entries[0]["overrides"]["roles"] == {"reload": "viewmodel_m4_grip_reload"}


def test_an_entry_with_nothing_left_to_say_keeps_no_empty_overrides():
    entries = [{"id": "grip", "overrides": {"roles": {"reload": "not_dumped"}}}]
    resolve_clips(entries, [])
    assert "overrides" not in entries[0]


def test_a_rigid_models_mount_is_derived_from_its_name():
    """`viewmodel_as50_scope_iw5` goes on `tag_as50_scope` — which the Barrett proves, being the one that is skinned."""
    assert derived_tag("viewmodel_as50_scope_iw5") == "tag_as50_scope"
    assert derived_tag("viewmodel_m82_scope_iw5") == "tag_m82_scope"

    entries = [
        {"id": "as50scope", "model": "viewmodel_as50_scope_iw5"},
        {"id": "thermal", "model": "t", "tag": "tag_thermal_scope"},
    ]
    resolve_mounts(entries, {"tag_as50_scope", "tag_thermal_scope", "tag_acog_2"})
    assert entries[0]["tag"] == "tag_as50_scope"


def test_a_gun_that_does_not_follow_the_naming_lends_its_own_scope_tag():
    """The MSR's and the L96A1's scopes mount on a plain `tag_scope`, which is the one tag left unclaimed."""
    entries = [
        {"id": "msrscope", "model": "viewmodel_remington_msr_scope_iw5"},
        {"id": "thermal", "model": "t", "tag": "tag_thermal_scope"},
    ]
    resolve_mounts(entries, {"tag_scope", "tag_thermal_scope", "tag_reticle_thermal_scope", "tag_acog_2"})
    assert entries[0]["tag"] == "tag_scope"


def test_an_ambiguous_mount_is_left_unresolved_rather_than_guessed():
    """A scope on the wrong tag floats beside the rifle, and nothing downstream would complain."""
    entries = [{"id": "msrscope", "model": "viewmodel_nothing_like_it"}]
    resolve_mounts(entries, {"tag_scope", "tag_zoom_scope"})
    assert "tag" not in entries[0]


def test_a_mount_tag_this_gun_does_not_carry_takes_its_model_with_it():
    """One ACOG description is shared by every rifle; a model with nowhere to hang is worse than none."""
    entries = [
        {"id": "acog", "tag": "tag_acog_2", "model": "viewmodel_acog", "hideBones": ["tag_sight_on"]},
        {"id": "eotech", "tag": "tag_eotech", "model": "viewmodel_eotech"},
    ]
    restrict_bones(entries, {"tag_acog_2", "j_gun"})
    assert entries[0] == {"id": "acog", "tag": "tag_acog_2", "model": "viewmodel_acog"}
    assert entries[1] == {"id": "eotech"}


# --- Against the games themselves ---------------------------------------------


def test_iw4s_attachment_types_are_iw5s_own_word_for_the_same_names():
    """IW4 ships nothing to say what an attachment is, so `IW4_TYPES` is a table. IW5 checks it."""
    work = mw3_dump()
    if work is None:
        pytest.skip(f"needs MW3's attachment assets under one of {', '.join(MW3_DUMPS)}")
    defs = read_defs(work)
    shared = {name: defs[name]["type"] for name in IW4_TYPES if name in defs}
    assert shared, "the MW3 dump has none of MW2's attachment names"
    assert {name: IW4_TYPES[name] for name in shared} == shared
    assert set(IW4_TYPES) - set(defs) == {"fmj"}, "MW2's `fmj` is the only name MW3 does not also ship"


# The five combinations Modern Warfare 2 does not compose, and the one key each
# differs in: `ViewKickCenterSpeed`. On all five the ACOG takes 400 off the base
# and the grip puts 400 on, and the file the game ships for the pair is the base
# value again — so the game composed those two as *deltas* and they cancelled,
# where the catalogue holds an absolute per attachment and the later one wins.
# Named one by one rather than allowed as a class: a sixth would be a rule and
# not an accident, and this is the assertion that would say so.
MW2_UNCOMPOSED = [
    ("aug_acog_grip_mp", ["motion"]),
    ("m240_acog_grip_mp", ["motion"]),
    ("mg4_acog_grip_mp", ["motion"]),
    ("rpd_acog_grip_mp", ["motion"]),
    ("sa80_acog_grip_mp", ["motion"]),
]


@pytest.mark.skipif(not os.path.isdir(f"{MW2_DUMP}/weapons/weapons"), reason=f"needs MW2's companion zone in {MW2_DUMP}")
def test_every_two_attachment_weapon_file_mw2_ships_is_what_composing_its_attachments_gives():
    """The whole reason to trust the numbers: 806 combinations, and the game shipped 801 of the answers."""
    from scripts.cod.catalog import base_weapons, is_player_weapon
    from scripts.cod.viewmodel import parse_infostring

    root = f"{MW2_DUMP}/weapons/weapons"
    guns = {}
    for name in sorted(os.listdir(root)):
        with open(os.path.join(root, name)) as fh:
            info = parse_infostring(fh.read())
        if is_player_weapon(name, info):
            guns[name] = info

    bases = base_weapons(guns)
    assert len(bases) == 43, f"MW2's roster is 43 base weapons, not {len(bases)}"

    checked, wrong = 0, []
    for name, info in bases.items():
        entries = iw4_entries(name, info, guns)
        checked += sum(1 for tokens in split_variants(name, guns).values() if len(tokens) > 1)
        wrong += check_variants(name, info, guns, entries)

    assert checked == 806, f"MW2 ships 806 two-attachment weapon files, not {checked}"
    assert sorted(wrong) == MW2_UNCOMPOSED


def test_iw5_optic_aiming_clips_come_from_the_weapon_files_anim_overrides():
    # MW3's ACR: each optic names its own aiming clips on this gun, and a row
    # naming a second attachment (the launcher's ACOG) is a combination, not this.
    info = {
        "animOverrides": "\n".join(
            [
                "eotech none ads_up viewmodel_acr_eotech_ads_up none 0 0",
                "eotech none ads_down viewmodel_acr_eotech_ads_down none 0 0",
                "reflex none ads_up viewmodel_acr_reflex_ADS_up none 0 0",
                "m320 acog ads_up viewmodel_acr_gl_acog_ads_up none 0 0",
                "m320 none idle viewmodel_masada_gl_idle viewmodel_masada_gl_grenade_idle 0 0",
            ]
        )
    }
    assert iw5_roles(info, "eotech") == {"adsUp": "viewmodel_acr_eotech_ads_up", "adsDown": "viewmodel_acr_eotech_ads_down"}
    assert iw5_roles(info, "reflex") == {"adsUp": "viewmodel_acr_reflex_ADS_up"}
    # A launcher's own rows are the gun held with it fitted, and its own weapon's in the next column.
    assert iw5_roles(info, "m320") == {"idle": "viewmodel_masada_gl_idle"}
    assert iw5_roles(info, "m320", column=1) == {"idle": "viewmodel_masada_gl_grenade_idle"}
    assert iw5_roles(info, "acog") == {}


@pytest.mark.skipif(mw3_dump() is None, reason="needs MW3's attachment assets dumped (catalog --dump mw3)")
def test_iw5_silencer_and_grip_scale_the_guns_own_damage_and_recoil():
    # MW3's silencers take a quarter off both ends of the falloff, and its grips
    # cut how far a shot throws the aim and speed its recentring. Neither is an
    # absolute block, so neither shows up unless the scale is read.
    work = mw3_dump()
    info = parse_infostring(read_text(os.path.join(work, "weapons", "weapons", "iw5_m4_mp")))
    base = spec_of(info)
    defs = read_defs(work)
    shot = ballistics(info)["damage"]

    silenced = iw5_entry("silencer", defs["silencer"], base, info=info)["overrides"]
    assert silenced["damage"] == {"max": pytest.approx(shot["max"] * 0.75), "min": pytest.approx(shot["min"] * 0.75)}

    gripped = iw5_entry("grip", defs["grip"], base, info=info)["overrides"]["motion"]
    assert gripped["hipViewKickPitchMax"] == pytest.approx(base["motion"]["hipViewKickPitchMax"] * 0.9, rel=1e-6)
    assert gripped["adsViewKickCenterSpeed"] == pytest.approx(base["motion"]["adsViewKickCenterSpeed"] * 1.25, rel=1e-6)

    # And an attachment that scales neither changes neither.
    assert "damage" not in iw5_entry("xmags", defs["xmags"], base, info=info)["overrides"]


@pytest.mark.skipif(mw3_dump() is None, reason="needs MW3's attachment assets dumped (catalog --dump mw3)")
def test_iw5_underbarrel_is_a_second_weapon_with_its_own_magazine_clips_sound_and_round():
    # MW3's `gl` on an M4: an M203 the game switches to with `alt_raise`. Its
    # numbers are the attachment's, its clips and fire sound the alt columns of the
    # M4's own tables, and none of it is folded onto the rifle.
    work = mw3_dump()
    info = parse_infostring(read_text(os.path.join(work, "weapons", "weapons", "iw5_m4_mp")))
    defs = read_defs(work)
    entry = iw5_entry("gl", defs["gl"], spec_of(info), info=info)
    alt = entry["alt"]
    assert (alt["clipSize"], alt["stock"], alt["weaponType"], alt["fireType"]) == (1, 1, "projectile", "Single Shot")
    assert alt["projectile"]["model"] == "projectile_m203grenade"
    assert (alt["projectile"]["activateDistance"], alt["projectile"]["explosionRadius"]) == (300, 300)
    assert alt["roles"]["altRaise"] == "viewmodel_M4m203_bullet_2_grenade"
    assert alt["roles"]["fire"] == "viewmodel_M4m203_grenade_fire"
    assert alt["sounds"]["firePlayer"] == "weap_m203_fire_plr"
    # The rifle itself, held with a launcher under it, has its own clips too.
    assert entry["overrides"]["roles"]["idle"] == "viewmodel_M4m203_idle"
    assert entry["overrides"]["roles"]["altRaise"] == "viewmodel_M4m203_grenade_2_bullet"
    assert "clipSize" not in entry.get("overrides", {})

    shotgun = iw5_entry("shotgun", defs["shotgun"], spec_of(info), info=info)["alt"]
    assert (shotgun["clipSize"], shotgun["stock"], shotgun["shotCount"], shotgun["roundsPerLoad"]) == (4, 8, 6, 1)
    assert shotgun["weaponType"] == "bullet" and "projectile" not in shotgun


@pytest.mark.skipif(mw3_dump() is None, reason="needs MW3's attachment assets dumped (catalog --dump mw3)")
def test_iw5_hybrid_is_a_second_weapon_on_the_same_magazine_magnified_by_default():
    # `shareAmmoWithAlt`: the gun comes magnified (`adsSettingsMain`, 30) and flips
    # to the holographic (`adsSettings`, 55) with its own `alt_raise`.
    work = mw3_dump()
    info = parse_infostring(read_text(os.path.join(work, "weapons", "weapons", "iw5_m4_mp")))
    entry = iw5_entry("hybrid", read_defs(work)["hybrid"], spec_of(info), info=info)
    assert entry["overrides"]["adsZoomFov"] == 30
    assert entry["alt"] == {
        "shareAmmo": True,
        "stock": 0,
        "adsZoomFov": 55,
        "roles": {
            "altRaise": "viewmodel_m4_hybrid_scope_down",
            "adsUp": "viewmodel_m4_hybrid_eotech_ads_up",
            "adsDown": "viewmodel_m4_hybrid_eotech_ads_down",
            "adsFire": "viewmodel_m4_hybrid_eotech_ads_fire",
        },
        "times": {"altRaise": 1.1, "adsIn": pytest.approx(0.35), "adsOut": pytest.approx(0.35)},
    }


@pytest.mark.skipif(mw3_dump() is None, reason="needs MW3's attachment assets dumped (catalog --dump mw3)")
def test_iw5_tactical_knife_holds_the_pistol_with_a_knife_and_stabs_quicker():
    # The USP's `tactical`: every clip is the knife-in-hand version, and its stab
    # takes 0.529 s against the pistol's own `meleeTime` of 0.8.
    work = mw3_dump()
    info = parse_infostring(read_text(os.path.join(work, "weapons", "weapons", "iw5_usp45_mp")))
    base = spec_of(info)
    assert base["times"]["melee"] == 0.8
    assert base["roles"]["melee"] == "viewmodel_knife_melee_slice"
    overrides = iw5_entry("tactical", read_defs(work)["tactical"], base, info=info)["overrides"]
    assert overrides["tacticalKnife"] is True
    assert overrides["roles"]["melee"] == "viewmodel_USPMGS_melee"
    assert overrides["roles"]["idle"] == "viewmodel_USPMGS_idle"
    assert overrides["times"]["melee"] == pytest.approx(0.529)
