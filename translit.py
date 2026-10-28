"""Rule-based Devanagari -> Roman transliteration (used as the Hindi pronunciation guide)."""
V = {'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri','ऑ':'o'}
M = {'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','ृ':'ri','ॉ':'o'}
C = {'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
     'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
     'प':'p','फ':'f','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh',
     'ष':'sh','स':'s','ह':'h','ळ':'l','ड़':'d','ढ़':'dh'}

def _word(w):
    out, i, n, inh = [], 0, len(w), None
    while i < n:
        ch = w[i]
        if ch in C:
            out.append(C[ch])
            nxt = w[i + 1] if i + 1 < n else ''
            if nxt in M:
                out.append(M[nxt]); i += 1; inh = None
            elif nxt == '्':
                i += 1; inh = None
            else:
                out.append('a'); inh = len(out) - 1
        elif ch in V:
            out.append(V[ch]); inh = None
        elif ch in M:
            out.append(M[ch])
        elif ch in 'ंँ':
            out.append('n')
        elif ch == 'ः':
            out.append('h')
        elif ch == '़':
            pass
        else:
            out.append(ch)
        i += 1
    # schwa deletion: final inherent 'a' is silent in Hindi (kamal, not kamala)
    if inh is not None and inh == len(out) - 1 and len(out) > 2:
        out.pop()
    return ''.join(out)

def deva_to_roman(text):
    return ' '.join(_word(w) for w in text.split())
