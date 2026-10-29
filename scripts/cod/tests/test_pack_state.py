from scripts.cod.pack import apply_state, drawn_technique

STATE = {"doubleSided": False, "blend": "alpha", "alphaTest": None, "sortKey": 53, "castsShadow": False}


def test_a_reflex_sight_material_says_so_in_its_extras():
    # MW3's reticles: a white mask with no alpha, which only the shader can key out.
    mat = {}
    apply_state(mat, {**STATE, "techniqueSet": "mc_reflexsight"})
    assert mat["alphaMode"] == "BLEND"
    assert mat["extras"]["technique"] == "reflexsight"


def test_an_ordinary_material_carries_no_technique():
    mat = {}
    apply_state(mat, {**STATE, "techniqueSet": "mc_l_sm_b0c0n0s0p0_sat"})
    assert "technique" not in mat["extras"]
    assert drawn_technique(None) is None
