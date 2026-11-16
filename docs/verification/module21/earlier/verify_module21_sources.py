#!/usr/bin/env python3
"""
Module 21 source verification (READ-ONLY): compares the three data files and prints every figure quoted in the report.
It never writes to the project, never touches a database and never modifies the input files (zips are read in place, QUL is opened read-only).

Usage:  python3 verify_module21_sources.py [KFGQPC_ZIP] [QUL_ZIP] [TANZIL_XML]
Needs:  python3 with python-docx (pip install python-docx).
"""
import sys, io, csv, json, zipfile, sqlite3, tempfile, hashlib, unicodedata, collections, os
import xml.etree.ElementTree as ET
import docx

KZ = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/uploads/kfgqpc_hafs_v30.zip'
QZ = sys.argv[2] if len(sys.argv) > 2 else '/mnt/user-data/uploads/qpc-v1-15-lines_db.zip'
TX = sys.argv[3] if len(sys.argv) > 3 else '/mnt/user-data/uploads/quran-data.xml'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def head(t): print('\n' + '=' * 8, t)

# ---------- 0. provenance ----------
head('0. File checksums (published SHA-256 of kfgqpc_hafs_v30.zip: 227E6B15...C635F245)')
for p in (KZ, QZ, TX): print(f'  {hashlib.sha256(open(p,"rb").read()).hexdigest()}  {os.path.basename(p)}')

kz = zipfile.ZipFile(KZ)
def kf(name): return next(n for n in kz.namelist() if n.endswith(name))
J = json.loads(kz.read(kf('kfgqpc_hafs_v30.json')).decode('utf-8'))
C = list(csv.DictReader(io.StringIO(kz.read(kf('kfgqpc_hafs_v30.csv')).decode('utf-8'))))
tmp = tempfile.mkdtemp(); zipfile.ZipFile(QZ).extractall(tmp)
dbp = next(os.path.join(r, f) for r, _, fs in os.walk(tmp) for f in fs if f.endswith('.db'))
db = sqlite3.connect(f'file:{dbp}?mode=ro', uri=True)
Q = collections.defaultdict(dict)
for p, l, t, c, f, la, s in db.execute('select page_number,line_number,line_type,is_centered,first_word_id,last_word_id,surah_number from pages'): Q[p][l] = (t, c, f, la, s)
QL = [(p, l, Q[p][l]) for p in sorted(Q) for l in sorted(Q[p])]
R = ET.parse(TX).getroot()
def tz(sec, tag): return [(int(e.get('index')), int(e.get('sura')), int(e.get('aya'))) for e in R.find(sec).findall(tag)]
TZ_SUR = [(int(e.get('index')), int(e.get('ayas'))) for e in R.find('suras')]
TZ_JUZ, TZ_Q, TZ_PAGE = tz('juzs', 'juz'), tz('hizbs', 'quarter'), tz('pages', 'page')

# ---------- 1. official CSV / JSON ----------
head('1. Official KFGQPC Hafs v30 (CSV / JSON)')
print('  rows', len(J), '| JSON == CSV on every compared field:', all(str(j['id']) == c['id'] and str(j['page']) == c['page'] and str(j['line_start']) == c['line_start'] and str(j['line_end']) == c['line_end'] and str(j['aya_no']) == c['aya_no'] and str(j['sura_no']) == c['sura_no'] and str(j['jozz']) == c['jozz'] and j['aya_text_unicode'] == c['aya_text_unicode'] for j, c in zip(J, C)))
cnt = collections.Counter(r['sura_no'] for r in J)
print('  surahs', len(cnt), '| ids 1..6236 in order:', [r['id'] for r in J] == list(range(1, 6237)), '| pages', min(r['page'] for r in J), '..', max(r['page'] for r in J), '| ayahs with line_end<line_start:', sum(r['line_end'] < r['line_start'] for r in J))

# ---------- 2. word mapping (rub marks are not words in QUL) ----------
WR = {}; pos = 0
for r in J:
    n = len([t for t in r['aya_text_unicode'].split() if t != '۞']); WR[(r['sura_no'], r['aya_no'])] = (pos + 1, pos + n); pos += n
head('2. Word alignment official text <-> QUL')
print('  official tokens (incl. standalone ۞):', sum(len(r['aya_text_unicode'].split()) for r in J), '| standalone ۞ tokens:', sum(r['aya_text_unicode'].split().count('۞') for r in J), '| words without ۞:', pos, '| QUL max word id:', max(v[3] for _, _, v in QL if v[3]))
print('  QUL info:', db.execute('select * from info').fetchall(), '| lines/page:', collections.Counter(len(v) for v in Q.values()), '| types:', collections.Counter(v[0] for _, _, v in QL))
print('  QUL basmallah lines with a surah_number:', sum(1 for _, _, v in QL if v[0] == 'basmallah' and v[4] not in (None, '')), 'of', sum(1 for _, _, v in QL if v[0] == 'basmallah'))
seq = [(p, l, v[2], v[3]) for p, l, v in QL if v[0] == 'ayah']
print('  QUL ayah-line word ranges contiguous 1..N:', all(b[2] == a[3] + 1 for a, b in zip(seq, seq[1:])))

# ---------- 3. official DOCX layout ----------
head('3. Official DOCX: page/line layout reconstructed from its <w:br> breaks')
d = docx.Document(io.BytesIO(kz.read(kf('kfgqpc_hafs_v30.docx'))))
lines = []; page = 1; cur = []; lineno = 0
def flush(pi, endpage=False):
    global cur, lineno, page
    t = ''.join(cur).replace('\xa0', ' ').strip()
    if t: lineno += 1; lines.append((page, lineno, t, pi))
    cur = []
    if endpage: page += 1; lineno = 0
for pi, p in enumerate(d.paragraphs):
    for el in p._p.iter():
        tag = el.tag.replace(W, '')
        if tag == 't' and el.text: cur.append(el.text)
        elif tag == 'tab': cur.append(' ')
        elif tag == 'br': flush(pi, endpage=(el.get(W + 'type') == 'page'))
    flush(pi)
per = collections.Counter(p for p, _, _, _ in lines)
print('  pages', page, '| lines', len(lines), '| lines per page:', dict(collections.Counter(per.values())), '| pages with 8 lines:', [p for p in per if per[p] == 8])
skel = lambda x: ''.join(c for c in x if unicodedata.category(c).startswith('L') or c == ' ')
BASM = ' '.join(J[0]['aya_text_unicode'].split()[:-1])
byp = collections.defaultdict(list)
for i, (pg, ln, tx, pidx) in enumerate(lines): byp[pidx].append(i)
kind = {}
for pidx, idxs in byp.items():
    full = ' '.join(lines[i][2] for i in idxs)
    if len(idxs) == 1 and full.startswith('سُورَةُ') and len(full) < 40: kind[idxs[0]] = 'banner'
    elif len(idxs) == 1 and skel(full) == skel(BASM): kind[idxs[0]] = 'basmala'
    else:
        for i in idxs: kind[i] = 'text'
print('  line kinds:', dict(collections.Counter(kind.values())))
D = [(pg, ln, t) for i, (pg, ln, tx, p) in enumerate(lines) if kind[i] == 'text' for t in tx.split() if t != '۞']
CT = [t for r in J for t in r['aya_text_unicode'].split() if t != '۞']
print('  DOCX text tokens', len(D), '== CSV tokens', len(CT), '| position-wise mismatches:', sum(1 for a, b in zip(D, CT) if a[2] != b))
DX = {}
for r in J:
    k = (r['sura_no'], r['aya_no']); a, b = WR[k]; DX[k] = (*D[a - 1][:2], *D[b - 1][:2])
ok = sum(1 for r in J if (r['page'], r['line_start'], r['line_end']) == (DX[(r['sura_no'], r['aya_no'])][0], DX[(r['sura_no'], r['aya_no'])][1], DX[(r['sura_no'], r['aya_no'])][3]) and DX[(r['sura_no'], r['aya_no'])][0] == DX[(r['sura_no'], r['aya_no'])][2])
print('  CSV (page,line_start,line_end) == DOCX position, ayahs:', ok, 'of 6236 | ayahs crossing a page in DOCX:', sum(1 for v in DX.values() if v[0] != v[2]))

# ---------- 4. CSV vs QUL ----------
head('4. Official CSV vs QUL V1 (1405) - the reported mismatch')
t = lambda p, l: (Q[p].get(l) or (None,))[0]
print('  ayahs whose line RANGE is entirely non-ayah lines in QUL      :', sum(all(t(r['page'], l) != 'ayah' for l in range(r['line_start'], r['line_end'] + 1)) for r in J), '   <-- the reported 74')
print('  ayahs with at least one declared line non-ayah in QUL          :', sum(any(t(r['page'], l) != 'ayah' for l in range(r['line_start'], r['line_end'] + 1)) for r in J))
print('  example 23:118 CSV', [(r['page'], r['line_start'], r['line_end']) for r in J if (r['sura_no'], r['aya_no']) == (23, 118)], '| DOCX', DX[(23, 118)], '| QUL p349 line15 type:', t(349, 15), '| QUL p350 line1/2:', t(350, 1), t(350, 2))
def qul_lines(w1, w2): return [(p, l) for p, l, v in QL if v[0] == 'ayah' and v[2] <= w2 and v[3] >= w1]
same = sum(1 for r in J if set(qul_lines(*WR[(r['sura_no'], r['aya_no'])])) == {(r['page'], l) for l in range(r['line_start'], r['line_end'] + 1)})
print('  ayahs whose QUL (word-derived) line set equals the CSV line set:', same, 'of 6236 | different:', 6236 - same)
dk = {(pg, ln): {'banner': 'surah_name', 'basmala': 'basmallah', 'text': 'ayah'}[kind[i]] for i, (pg, ln, tx, p) in enumerate(lines)}
dis = [pl for pl in dk if Q[pl[0]][pl[1]][0] != dk[pl]]
print('  (page,line) cells whose KIND differs DOCX vs QUL:', len(dis), '=', len(dis) // 3, 'sites x 3 lines (banner / basmala / text moved across a page break)')
dfirst, qfirst = {}, {}
w = 0
for i, (pg, ln, tx, p) in enumerate(lines):
    if kind[i] == 'text': dfirst.setdefault(pg, w + 1); w += len([x for x in tx.split() if x != '۞'])
for p, l, v in QL:
    if v[0] == 'ayah': qfirst.setdefault(p, v[2])
dp = [p for p in range(1, 605) if dfirst[p] != qfirst[p]]
print('  pages with the same first text word in both layouts:', 604 - len(dp), 'of 604 | first differing page:', dp[0], '| pages 263-451 shifted by exactly +1 word:', sum(1 for p in range(263, 452) if qfirst[p] - dfirst[p] == 1))
print('  QUL ayahs crossing a page:', sum(1 for k, (a, b) in WR.items() if qul_lines(a, a)[0][0] != qul_lines(b, b)[0][0]), '| official layout:', 0)
dls = set(); w = 0
for i, (pg, ln, tx, p) in enumerate(lines):
    if kind[i] == 'text': dls.add(w + 1); w += len([x for x in tx.split() if x != '۞'])
qls = {v[2] for _, _, v in QL if v[0] == 'ayah'}
print('  text lines starting at the same word:', len(dls & qls), 'of 8820')

# ---------- 5. Tanzil ----------
head('5. Tanzil quran-data.xml')
ORACLE = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6]
print('  header:', R.attrib, '| ayahs per surah: CSV == Tanzil == project oracle:', [cnt[i] for i in range(1, 115)] == [a for _, a in TZ_SUR] == ORACLE, '| sum', sum(ORACLE))
print('  counts: surahs', len(TZ_SUR), 'juz', len(TZ_JUZ), 'quarters', len(TZ_Q), 'pages', len(TZ_PAGE), '| juz k == quarter 8(k-1)+1:', all((TZ_Q[8 * (j - 1)][1], TZ_Q[8 * (j - 1)][2]) == (s, a) for j, s, a in TZ_JUZ), '| quarters strictly increasing:', all(a[1:] < b[1:] for a, b in zip(TZ_Q, TZ_Q[1:])))
first_of = {}
for r in J: first_of.setdefault(r['jozz'], (r['sura_no'], r['aya_no']))
M = {(r['sura_no'], r['aya_no']) for r in J if '۞' in r['aya_text_unicode']}
print('  CSV `jozz` start != Tanzil juz start:', [(j, first_of[j], (s, a)) for j, s, a in TZ_JUZ if first_of[j] != (s, a)])
print('  official ۞ present at the Tanzil start of those juz:', [((s, a) in M) for j, s, a in TZ_JUZ if first_of[j] != (s, a)], '| ۞ present at the CSV-jozz start:', [(first_of[j] in M) for j, s, a in TZ_JUZ if first_of[j] != (s, a)])
T = {(s, a): q for q, s, a in TZ_Q}
print('  official ۞ marks:', len(M), '(all at index 0 of the ayah text:', all(r['aya_text_unicode'].index('۞') == 0 for r in J if '۞' in r['aya_text_unicode']), ') | in Tanzil quarter starts:', len(M & set(T)), '| NOT in Tanzil:', sorted(M - set(T)), '| Tanzil starts without a mark:', len(set(T) - M), '(of which ayah 1 of a surah:', sum(1 for k in set(T) - M if k[1] == 1), '; others:', sorted(k for k in set(T) - M if k[1] != 1), ')')
print('  199 official marks + 41 surah-initial quarters =', len(M) + sum(1 for k in set(T) - M if k[1] == 1), '(Tanzil quarters:', len(TZ_Q), ')')
cf = {}
for r in J: cf.setdefault(r['page'], (r['sura_no'], r['aya_no']))
tzf = {p: (s, a) for p, s, a in TZ_PAGE}
def ayah_of_word(wd):
    for k, (a, b) in WR.items():
        if a <= wd <= b: return k
print('  Tanzil page-start ayah vs official CSV first ayah of page: mismatching pages =', sum(1 for p in range(1, 605) if cf[p] != tzf[p]), '| vs QUL (first word of page): mismatching pages =', sum(1 for p in range(1, 605) if ayah_of_word(qfirst[p]) != tzf[p]))

# ---------- 6. project reference constants (MADINAH_HAFS_604_PROFILE) ----------
head('6. Project reference constants vs real data')
for s, a, pg in [(1, 1, 1), (2, 1, 2), (2, 142, 22), (78, 1, 582)]:
    k = (s, a); print(f'  ayah {s}:{a} first page: profile {pg} | CSV {[r["page"] for r in J if (r["sura_no"], r["aya_no"]) == k][0]} | DOCX {DX[k][0]}')
for q, s, a in [(1, 1, 1), (9, 2, 142), (17, 2, 253), (233, 78, 1)]:
    print(f'  quarter {q}: profile {s}:{a} | Tanzil {TZ_Q[q - 1][1:]} | official ۞ at that ayah: {(s, a) in M}')
