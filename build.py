#!/usr/bin/env python3
"""Сборка веб-версии: www/ → dist/.
Убирает отступы и строки-комментарии в JS/CSS (без изменения логики)
и проставляет в sw.js версию кэша по содержимому файлов, чтобы телефоны
получали обновления."""
import hashlib, pathlib, re, shutil

ROOT = pathlib.Path(__file__).parent
SRC, DST = ROOT / 'www', ROOT / 'dist'

def slim_js(text):
    out, in_tpl = [], False
    for line in text.split('\n'):
        ticks = len(re.findall(r'(?<!\\)`', line))
        if in_tpl:
            out.append(line)
        else:
            s = line.strip()
            if s and not s.startswith('//'):
                out.append(s)
        if ticks % 2:
            in_tpl = not in_tpl
    return '\n'.join(out) + '\n'

def slim_css(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return '\n'.join(l.strip() for l in text.split('\n') if l.strip()) + '\n'

DST.mkdir(exist_ok=True)
for item in DST.iterdir():          # очищаем содержимое, сохраняя саму папку
    shutil.rmtree(item) if item.is_dir() else item.unlink()
shutil.copytree(SRC, DST, ignore=shutil.ignore_patterns('icon.svg'), dirs_exist_ok=True)
for f in DST.rglob('*.js'):
    f.write_text(slim_js(f.read_text(encoding='utf-8')), encoding='utf-8')
for f in DST.rglob('*.css'):
    f.write_text(slim_css(f.read_text(encoding='utf-8')), encoding='utf-8')

h = hashlib.sha1()
for f in sorted(DST.rglob('*')):
    if f.is_file() and f.name != 'sw.js':
        h.update(f.relative_to(DST).as_posix().encode()); h.update(f.read_bytes())
sw = DST / 'sw.js'
sw.write_text(re.sub(r"const VERSION = '[^']*';", f"const VERSION = 'kern-{h.hexdigest()[:10]}';", sw.read_text(encoding='utf-8')), encoding='utf-8')

total = sum(f.stat().st_size for f in DST.rglob('*') if f.is_file())
print(f'dist: {total} байт, версия кэша kern-{h.hexdigest()[:10]}')
