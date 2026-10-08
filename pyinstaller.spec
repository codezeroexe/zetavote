# -*- mode: python ; coding: utf-8 -*-

block_cipher = None


a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=[],
    # The built UI. backend/app.py mounts frontend/dist, so without this the
    # packaged app serves the API and nothing else.
    datas=[("frontend/dist", "frontend/dist")],
    hiddenimports=[
        "backend",
        "backend.app",
        "backend.audit",
        "backend.config",
        "backend.crypto",
        "backend.database",
        "backend.merkle",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ZetaVote",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ZetaVote",
)
