#!/usr/bin/env python3
"""Build a Windows portable ZIP from an explicit, account-free file allowlist."""
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = '1.0.0-rc.1'
NODE_VERSION = 'v24.20.0'
NAME = f'AI-Council-{VERSION}-windows-x64'
CACHE = ROOT / '.build/windows-downloads'
STAGE = ROOT / '.build/windows-release' / NAME
DIST = ROOT / 'dist'
ARCHIVE_NAME = f'node-{NODE_VERSION}-win-x64.zip'
SCRIPTS = [
    'lib.mjs', 'agent-binaries.mjs', 'chat-server.mjs', 'chat-policy.mjs',
    'chat-protocol.mjs', 'chat-progress.mjs', 'chat-prompt.mjs', 'chat-sessions.mjs',
    'chat-settings.mjs', 'project-catalog.mjs', 'windows-agents.mjs', 'windows-desktop.mjs',
]
PUBLIC = ['index.html', 'app.js', 'i18n.js', 'styles.css', 'flat-theme.css',
          'logos/claude.svg', 'logos/codex.svg', 'logos/gemini.svg']
LAUNCHERS = ['Start-AI-Council.cmd', 'Launch.ps1', 'Install-Model-CLIs.cmd',
             'Install-Model-CLIs.ps1', 'README-WINDOWS.md']


def checksum(file):
    with file.open('rb') as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
        return digest.hexdigest()


def download(filename):
    target = CACHE / filename
    if not target.exists():
        url = f'https://nodejs.org/dist/{NODE_VERSION}/{filename}'
        temporary = target.with_suffix(target.suffix + '.download')
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(target)
    return target


def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(exist_ok=True)
    archive = download(ARCHIVE_NAME)
    sums = download('SHASUMS256.txt')
    expected = next(line.split()[0] for line in sums.read_text().splitlines() if line.split()[-1] == ARCHIVE_NAME)
    if checksum(archive) != expected:
        raise RuntimeError('Official Node.js SHA-256 verification failed. Refusing to package.')
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    copy(ROOT / 'THIRD_PARTY_NOTICES.md', STAGE / 'THIRD_PARTY_NOTICES.md')
    for filename in SCRIPTS:
        copy(ROOT / 'scripts' / filename, STAGE / 'app/scripts' / filename)
    for filename in PUBLIC:
        copy(ROOT / 'public' / filename, STAGE / 'app/public' / filename)
    for filename in LAUNCHERS:
        copy(ROOT / 'windows' / filename, STAGE / filename)
        if filename.endswith(('.cmd', '.ps1')):
            target = STAGE / filename
            target.write_bytes(target.read_text().replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))
    (STAGE / 'app/package.json').write_text(json.dumps({
        'name': 'ai-council-windows-preview', 'version': VERSION, 'private': True, 'type': 'module',
    }, indent=2) + '\n')
    browser_bundle = 'dist/browser/markdown-it.umd.min.js'
    copy(ROOT / 'node_modules/markdown-it' / browser_bundle,
         STAGE / 'app/node_modules/markdown-it' / browser_bundle)
    for package in ['markdown-it', 'argparse', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro']:
        directory = ROOT / 'node_modules' / package
        metadata = json.loads((directory / 'package.json').read_text())
        notice = STAGE / 'THIRD-PARTY-LICENSES' / package
        notice.mkdir(parents=True)
        (notice / 'package.json').write_text(json.dumps({key: metadata[key] for key in ['name', 'version', 'license'] if key in metadata}, indent=2))
        for file in directory.iterdir():
            if file.is_file() and (file.name.lower().startswith('license') or file.name.lower().startswith('copying')):
                copy(file, notice / file.name)
    # The official runtime also includes npm, allowing the optional CLI installer
    # to work without a separate Node installation. No host node_modules copied.
    with zipfile.ZipFile(archive) as source:
        prefix = f'node-{NODE_VERSION}-win-x64/'
        for item in source.infolist():
            if item.is_dir():
                continue
            if not item.filename.startswith(prefix):
                raise RuntimeError('Unexpected Node archive layout')
            relative = Path(item.filename[len(prefix):])
            if relative.is_absolute() or '..' in relative.parts:
                raise RuntimeError('Unsafe archive path')
            target = STAGE / 'runtime' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(item) as src, target.open('wb') as dst:
                shutil.copyfileobj(src, dst)
    manifest = {
        'version': VERSION, 'platform': 'windows-x64', 'status': 'preview-not-windows-tested',
        'nodeVersion': NODE_VERSION, 'nodeArchiveSha256': expected,
        'includedAccounts': False,
        'files': {str(file.relative_to(STAGE)).replace('\\', '/'): checksum(file)
                  for file in sorted(STAGE.rglob('*')) if file.is_file()},
    }
    (STAGE / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    destination = DIST / f'{NAME}.zip'
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for file in sorted(STAGE.rglob('*')):
            if file.is_file():
                output.write(file, f'{NAME}/{file.relative_to(STAGE).as_posix()}')
    (DIST / f'{NAME}.sha256').write_text(f'{checksum(destination)}  {destination.name}\n')
    print(json.dumps({'release': str(destination), 'bytes': destination.stat().st_size,
                      'sha256': checksum(destination), 'files': len(manifest['files'])}, indent=2))


if __name__ == '__main__':
    main()
