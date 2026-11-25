"""Summarize the size of a built APK using its ZIP directory."""

import sys
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile


def group_for(name):
    if name.startswith('lib/'):
        return 'Native libraries'
    if name == 'assets/index.android.bundle':
        return 'JavaScript bundle'
    if name.startswith('assets/'):
        return 'Other assets'
    if name.startswith('classes') and name.endswith('.dex') and '/' not in name:
        return 'DEX bytecode'
    if name.startswith('res/') or name == 'resources.arsc':
        return 'Android resources'
    return 'Other entries'


def report(apk_path):
    apk_path = Path(apk_path)
    print(f'## APK size · {apk_path.name}')
    print(f'\nSigned APK: **{apk_path.stat().st_size / 1_000_000:.2f} MB**.\n')
    with ZipFile(apk_path) as apk:
        sizes = defaultdict(lambda: [0, 0])
        entries = [entry for entry in apk.infolist() if not entry.is_dir()]
        for entry in entries:
            group = sizes[group_for(entry.filename)]
            group[0] += entry.compress_size
            group[1] += entry.file_size

        print('| Group | Packed (MiB) | Uncompressed (MiB) |')
        print('| --- | ---: | ---: |')
        for label, (packed, unpacked) in sorted(sizes.items(), key=lambda item: -item[1][0]):
            print(f'| {label} | {packed / 2**20:.2f} | {unpacked / 2**20:.2f} |')

        print('\n### Largest native libraries\n')
        print('| Entry | Packed (MiB) | Uncompressed (MiB) |')
        print('| --- | ---: | ---: |')
        libraries = (entry for entry in entries if entry.filename.startswith('lib/'))
        for entry in sorted(libraries, key=lambda item: -item.compress_size)[:10]:
            print(f'| `{entry.filename}` | {entry.compress_size / 2**20:.2f} | {entry.file_size / 2**20:.2f} |')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/report-apk-size.py <signed.apk>')
    report(sys.argv[1])
