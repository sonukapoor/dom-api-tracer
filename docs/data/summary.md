# DOM API usage report

Generated 2026-10-08T18:10:22.990Z from **4151** test files across **20** project(s).
Environments observed: happy-dom, jsdom.

## Surface area

| Metric | Value |
| --- | --- |
| Instrumentable members (catalog) | 7,298 |
| Members actually used | 1,148 (15.7% of catalog) |
| Used by ≥50% of projects ("core") | 165 |
| Used by ≥10% of projects ("common") | 815 |
| Total recorded operations | 282,289,565 |

## Coverage by environment

Each environment has its own catalog (it also varies by version), so coverage is reported per environment.

| Environment | Test files | Projects | Members available | Members used | Used % |
| --- | --- | --- | --- | --- | --- |
| jsdom | 2,864 | 17 | 5,887 | 1,006 | 17.1% |
| happy-dom | 1,287 | 6 | 2,983 | 518 | 17.4% |

## Coverage curve

How many members account for a given share of all recorded operations.

| Share of operations | Members needed |
| --- | --- |
| 50% | 8 |
| 80% | 32 |
| 90% | 56 |
| 95% | 84 |
| 99% | 174 |
| 100% | 1,148 |

## Most widely used members (top 50)

Breadth matters more than raw counts: a member used lightly by every project is a must-have.

| Member | Projects | Files | Ops |
| --- | --- | --- | --- |
| `Document#body` | 20 | 3602 | 2,375,112 |
| `Document#createElement` | 20 | 3399 | 5,222,308 |
| `window#navigator` | 20 | 3076 | 6,876,201 |
| `Node#appendChild` | 20 | 3059 | 5,145,349 |
| `EventTarget#addEventListener` | 20 | 2863 | 11,617,165 |
| `Node#parentNode` | 20 | 2634 | 2,312,772 |
| `Element#setAttribute` | 20 | 2621 | 12,161,620 |
| `Element#tagName` | 20 | 2346 | 4,674,411 |
| `Node#nodeType` | 20 | 2302 | 18,611,696 |
| `Node#nextSibling` | 20 | 1302 | 1,350,139 |
| `Element#innerHTML` | 20 | 828 | 207,509 |
| `Element#getAttribute` | 19 | 2323 | 7,644,805 |
| `NodeList#[Symbol.iterator]` | 19 | 2305 | 2,406,804 |
| `Element#querySelectorAll` | 19 | 2141 | 229,183 |
| `Document#createTextNode` | 19 | 2121 | 791,825 |
| `Element#id` | 19 | 1937 | 491,565 |
| `Element#removeAttribute` | 19 | 1905 | 1,029,027 |
| `Node#childNodes` | 19 | 1901 | 4,275,398 |
| `Node#insertBefore` | 19 | 1729 | 1,113,137 |
| `Element#querySelector` | 19 | 1714 | 613,911 |
| `Element#hasAttribute` | 19 | 1588 | 1,504,228 |
| `Element#attributes` | 19 | 1312 | 1,342,508 |
| `Attr#value` | 19 | 1287 | 1,786,242 |
| `Event#target` | 19 | 1279 | 896,428 |
| `Element#remove` | 19 | 1256 | 987,636 |
| `Event#type` | 19 | 1138 | 945,345 |
| `HTMLInputElement#type` | 19 | 838 | 515,852 |
| `HTMLElement#style` | 18 | 3128 | 10,891,212 |
| `Document#activeElement` | 18 | 2734 | 961,413 |
| `Node#getRootNode` | 18 | 2386 | 526,936 |
| `Node#removeChild` | 18 | 2340 | 238,369 |
| `Node#parentElement` | 18 | 1948 | 4,553,509 |
| `EventTarget#removeEventListener` | 18 | 1790 | 2,806,308 |
| `Node#contains` | 18 | 1642 | 828,890 |
| `NamedNodeMap#[Symbol.iterator]` | 18 | 1180 | 1,307,354 |
| `HTMLElement#focus` | 18 | 1103 | 36,244 |
| `Element#shadowRoot` | 18 | 868 | 287,575 |
| `Event#preventDefault` | 18 | 831 | 38,116 |
| `HTMLInputElement#value` | 18 | 766 | 226,564 |
| `CharacterData#data` | 18 | 212 | 862,446 |
| `HTMLElement#click` | 18 | 167 | 5,807 |
| `Navigator#userAgent` | 17 | 2977 | 177,047 |
| `Node#ownerDocument` | 17 | 2579 | 8,205,875 |
| `Node#textContent` | 17 | 2116 | 682,860 |
| `window#getComputedStyle` | 17 | 2110 | 1,893,227 |
| `Node#firstChild` | 17 | 1998 | 1,283,722 |
| `Document#documentElement` | 17 | 1692 | 564,769 |
| `Element#namespaceURI` | 17 | 1640 | 3,294,399 |
| `Element#matches` | 17 | 1480 | 6,093,934 |
| `Element#closest` | 17 | 1425 | 1,525,419 |

## Hottest members by operation count (top 50)

These are the paths a fast implementation must optimize first. "Top file share" is the part of a member's operations that comes from its single busiest test file: high values mean one heavy test, not general use.

| Member | Calls | Gets | Sets | Ops | Files | Top file share |
| --- | --- | --- | --- | --- | --- | --- |
| `Performance#now` | 62523829 | 0 | 0 | 62,523,829 | 793 | 6.7% |
| `Node#nodeType` | 0 | 18611696 | 0 | 18,611,696 | 2302 | 9.3% |
| `Element#setAttribute` | 12161620 | 0 | 0 | 12,161,620 | 2621 | 3.7% |
| `EventTarget#addEventListener` | 11617165 | 0 | 0 | 11,617,165 | 2863 | 3.5% |
| `HTMLElement#style` | 0 | 10891212 | 0 | 10,891,212 | 3128 | 2.2% |
| `Element#classList` | 0 | 10028686 | 0 | 10,028,686 | 1380 | 2.0% |
| `Node#ownerDocument` | 0 | 8205875 | 0 | 8,205,875 | 2579 | 3.8% |
| `Element#getAttribute` | 7644805 | 0 | 0 | 7,644,805 | 2323 | 1.7% |
| `window#navigator` | 0 | 6876201 | 0 | 6,876,201 | 3076 | 9.0% |
| `Element#matches` | 6093934 | 0 | 0 | 6,093,934 | 1480 | 16.7% |
| `DOMTokenList#toggle` | 6052893 | 0 | 0 | 6,052,893 | 769 | 3.3% |
| `Document#createElement` | 5222308 | 0 | 0 | 5,222,308 | 3399 | 3.8% |
| `Node#appendChild` | 5145349 | 0 | 0 | 5,145,349 | 3059 | 4.5% |
| `window#document` | 0 | 5137078 | 0 | 5,137,078 | 1919 | 3.9% |
| `Element#tagName` | 0 | 4674411 | 0 | 4,674,411 | 2346 | 5.4% |
| `Node#parentElement` | 0 | 4553509 | 0 | 4,553,509 | 1948 | 1.8% |
| `Node#childNodes` | 0 | 4275398 | 0 | 4,275,398 | 1901 | 3.0% |
| `Document#defaultView` | 0 | 4020335 | 0 | 4,020,335 | 936 | 7.6% |
| `Element#namespaceURI` | 0 | 3294399 | 0 | 3,294,399 | 1640 | 3.1% |
| `Element#className` | 0 | 51787 | 2832058 | 2,883,845 | 1320 | 2.3% |
| `EventTarget#removeEventListener` | 2806308 | 0 | 0 | 2,806,308 | 1790 | 2.0% |
| `DOMTokenList#contains` | 2717053 | 0 | 0 | 2,717,053 | 882 | 5.4% |
| `NodeList#[Symbol.iterator]` | 2406804 | 0 | 0 | 2,406,804 | 2305 | 2.6% |
| `Document#body` | 0 | 2375112 | 0 | 2,375,112 | 3602 | 2.5% |
| `Node#parentNode` | 0 | 2312772 | 0 | 2,312,772 | 2634 | 6.9% |
| `CSSStyleDeclaration#width` | 0 | 1356528 | 886249 | 2,242,777 | 789 | 2.4% |
| `Element#nodeName` | 0 | 2075380 | 0 | 2,075,380 | 1056 | 1.9% |
| `Node#nodeName` | 0 | 2048386 | 0 | 2,048,386 | 1426 | 2.8% |
| `window#getComputedStyle` | 1893227 | 0 | 0 | 1,893,227 | 2110 | 4.6% |
| `Navigator#platform` | 0 | 1891148 | 0 | 1,891,148 | 1427 | 7.9% |
| `Node#cloneNode` | 1853259 | 0 | 0 | 1,853,259 | 779 | 2.6% |
| `Attr#value` | 0 | 1786242 | 0 | 1,786,242 | 1287 | 18.2% |
| `CSSStyleDeclaration#height` | 0 | 1376050 | 359552 | 1,735,602 | 807 | 2.9% |
| `Element#closest` | 1525419 | 0 | 0 | 1,525,419 | 1425 | 2.5% |
| `Element#hasAttribute` | 1504228 | 0 | 0 | 1,504,228 | 1588 | 8.6% |
| `Element#append` | 1433023 | 0 | 0 | 1,433,023 | 813 | 2.8% |
| `Node#nextSibling` | 0 | 1350139 | 0 | 1,350,139 | 1302 | 11.5% |
| `Element#attributes` | 0 | 1342508 | 0 | 1,342,508 | 1312 | 18.7% |
| `NamedNodeMap#[Symbol.iterator]` | 1307354 | 0 | 0 | 1,307,354 | 1180 | 19.2% |
| `Element#localName` | 0 | 1288331 | 0 | 1,288,331 | 744 | 9.3% |
| `Node#firstChild` | 0 | 1283722 | 0 | 1,283,722 | 1998 | 8.5% |
| `CSSStyleDeclaration#setProperty` | 1240782 | 0 | 0 | 1,240,782 | 1084 | 5.0% |
| `DOMRectReadOnly#left` | 0 | 1153202 | 0 | 1,153,202 | 859 | 3.9% |
| `DOMRectReadOnly#top` | 0 | 1150582 | 0 | 1,150,582 | 858 | 4.0% |
| `CSSStyleDeclaration#getPropertyValue` | 1116208 | 0 | 0 | 1,116,208 | 1274 | 10.5% |
| `Node#insertBefore` | 1113137 | 0 | 0 | 1,113,137 | 1729 | 5.4% |
| `Element#removeAttribute` | 1029027 | 0 | 0 | 1,029,027 | 1905 | 2.5% |
| `CSSStyleDeclaration#position` | 0 | 954251 | 39354 | 993,605 | 738 | 3.1% |
| `Element#remove` | 987636 | 0 | 0 | 987,636 | 1256 | 4.1% |
| `Document#activeElement` | 0 | 961413 | 0 | 961,413 | 2734 | 2.1% |

## Interfaces (top 50 by operations)

| Interface | Ops | Members used | Members available | Used % |
| --- | --- | --- | --- | --- |
| Element | 62,786,178 | 72 | 127 | 56.7% |
| Performance | 62,523,829 | 1 | 3 | 33.3% |
| Node | 54,378,915 | 27 | 31 | 87.1% |
| window | 16,737,827 | 168 | 236 | 71.2% |
| CSSStyleDeclaration | 14,988,515 | 152 | 2680 | 5.7% |
| Document | 14,797,033 | 43 | 203 | 21.2% |
| EventTarget | 14,707,633 | 5 | 6 | 83.3% |
| HTMLElement | 13,186,613 | 45 | 135 | 33.3% |
| DOMTokenList | 9,305,400 | 7 | 14 | 50.0% |
| Event | 3,124,420 | 16 | 17 | 94.1% |
| NodeList | 2,453,644 | 6 | 9 | 66.7% |
| DOMRectReadOnly | 2,329,602 | 4 | 9 | 44.4% |
| Navigator | 2,073,172 | 11 | 27 | 40.7% |
| Attr | 1,811,049 | 3 | 7 | 42.9% |
| HTMLInputElement | 1,328,498 | 40 | 62 | 64.5% |
| NamedNodeMap | 1,310,726 | 5 | 10 | 50.0% |
| CharacterData | 1,151,033 | 8 | 14 | 57.1% |
| DOMRect | 504,182 | 4 | 4 | 100.0% |
| TreeWalker | 415,760 | 6 | 11 | 54.5% |
| ResizeObserver | 284,715 | 3 | 3 | 100.0% |
| HTMLButtonElement | 273,248 | 10 | 21 | 47.6% |
| SVGElement | 203,181 | 6 | 113 | 5.3% |
| CSSStyleProperties | 171,893 | 103 | 1670 | 6.2% |
| Text | 167,634 | 3 | 6 | 50.0% |
| KeyboardEvent | 167,303 | 13 | 13 | 100.0% |
| ValidityState | 124,707 | 11 | 11 | 100.0% |
| MouseEvent | 85,066 | 19 | 21 | 90.5% |
| AbortController | 80,974 | 2 | 2 | 100.0% |
| HTMLTemplateElement | 73,537 | 2 | 6 | 33.3% |
| UIEvent | 73,291 | 3 | 4 | 75.0% |
| AbortSignal | 72,843 | 2 | 4 | 50.0% |
| IntersectionObserver | 67,369 | 3 | 4 | 75.0% |
| Storage | 52,408 | 4 | 5 | 80.0% |
| HTMLTextAreaElement | 51,353 | 26 | 34 | 76.5% |
| URL | 48,596 | 13 | 14 | 92.9% |
| HTMLCanvasElement | 40,482 | 3 | 12 | 25.0% |
| MutationObserver | 38,979 | 3 | 3 | 100.0% |
| HTMLCollection | 31,004 | 3 | 6 | 50.0% |
| DocumentFragment | 30,771 | 7 | 11 | 63.6% |
| Location | 27,390 | 9 | 13 | 69.2% |
| FocusEvent | 25,985 | 1 | 1 | 100.0% |
| Selection | 25,955 | 13 | 26 | 50.0% |
| HTMLOptionElement | 22,074 | 5 | 8 | 62.5% |
| URLSearchParams | 21,624 | 8 | 14 | 57.1% |
| MutationRecord | 20,408 | 5 | 9 | 55.6% |
| HTMLSelectElement | 12,698 | 20 | 26 | 76.9% |
| Screen | 12,544 | 1 | 6 | 16.7% |
| Range | 11,087 | 17 | 30 | 56.7% |
| HTMLAnchorElement | 8,336 | 17 | 27 | 63.0% |
| HTMLTableElement | 6,592 | 7 | 23 | 30.4% |
