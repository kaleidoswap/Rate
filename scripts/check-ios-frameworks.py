#!/usr/bin/env python3
"""Fail release packaging on missing embedded frameworks or stale Bare JS symbols."""
import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1])
frameworks = app / 'Frameworks'
with (app / 'Info.plist').open('rb') as f:
    info = plistlib.load(f)
    executable = info['CFBundleExecutable']
    if not info.get('UIApplicationSceneManifest', {}).get('UISceneConfigurations'):
        sys.exit('Missing scene lifecycle configuration: iOS 27 cannot launch this app.')
binaries = [app / executable] + [p / p.stem for p in frameworks.glob('*.framework')]
errors = []
exports = set()
required = set()
for binary in binaries:
    deps = subprocess.check_output(['otool', '-L', str(binary)], text=True)
    for line in deps.splitlines()[1:]:
        dep = line.strip().split(' (', 1)[0]
        if dep.startswith('@rpath/') and '.framework/' in dep:
            if not (frameworks / dep.removeprefix('@rpath/')).is_file():
                errors.append(f'{binary.name}: missing {dep}')
    defined = subprocess.check_output(['nm', '-gU', str(binary)], text=True, stderr=subprocess.DEVNULL)
    exports.update(line.split()[-1] for line in defined.splitlines() if line.split())
    undefined = subprocess.check_output(['nm', '-u', str(binary)], text=True, stderr=subprocess.DEVNULL)
    required.update(line.split()[-1] for line in undefined.splitlines() if line.split() and line.split()[-1].startswith('_js_'))
for symbol in sorted(required - exports):
    errors.append(f'Bare runtime does not export required symbol: {symbol}')
if errors:
    sys.exit('\n'.join(errors))
print(f'Verified framework dependencies and Bare symbols for {len(binaries)} binaries.')
