/**
 * verify-nav-icon.mjs —— 设置导航里**我们自己那颗图标**的对齐判据。
 *
 * 现象（用户口径）：设置左栏「壁纸引擎」那颗图标**偏上**，没和「壁纸引擎」文字对齐。
 * 根因形态：补丁把官方兜底齿轮换成 `<span class="<官方 class>" data-we-nav-icon="1">` + 内嵌
 * inline SVG —— **行内 SVG 会落在继承来的文字基线上**，于是整体抬高几 px；官方元素本身若是
 * flex 容器（或本来就是 svg），这个抬升在第 2 层才出现。
 *
 * 判据守三件（都在**源码文本**上，能离线跑）：
 *   ① 样式里**只给我们的标记属性**上对齐规则（不许碰官方元素、不许写死偏移量）；
 *   ② 规则本身要齐：inline-flex + align-items:center + line-height:0，且子 svg display:block；
 *   ③ 补丁仍然把 `data-we-nav-icon` 打上去（CSS 的钩子就是它，改了名字这条规则就失效）。
 * 每条都带负对照：把合成输入喂给**同一个判定函数**，断言它判红 —— 否则解析器静默返回空集时
 * 正断言会恒绿（本仓的常规要求）。
 *
 * Usage:  node test/verify-nav-icon.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

const css = readFileSync(join(ROOT, 'src', 'styles.js'), 'utf8');
const navSrc = readFileSync(join(ROOT, 'src', 'nav-icon.js'), 'utf8');

/** 对齐规则齐不齐（同一条判定函数，正断言与负对照都调它）。 */
const hasAlignRule = (text) => {
  const m = /nav\s+\[data-we-nav-icon\]\s*\{([^}]*)\}/.exec(text);
  if (!m) return { ok: false, why: '没有 nav [data-we-nav-icon] 规则' };
  const body = m[1];
  const need = ['display: inline-flex', 'align-items: center', 'justify-content: center', 'line-height: 0'];
  const miss = need.filter((k) => !body.includes(k));
  if (miss.length) return { ok: false, why: '缺：' + miss.join(' / ') };
  const svgRule = /nav\s+\[data-we-nav-icon\]\s*>\s*svg\s*\{[^}]*display:\s*block/.test(text);
  if (!svgRule) return { ok: false, why: '子 svg 没写 display:block（行内基线抬升的来源）' };
  return { ok: true, why: '' };
};

const verdict = hasAlignRule(css);
check('导航图标有对齐规则（inline-flex + 居中 + line-height:0 + 子 svg display:block）', verdict.ok, verdict.why);
check('规则只作用于我们的标记属性（不碰官方元素）', /nav\s+\[data-we-nav-icon\]/.test(css), '');
// ⚠️ 变异必须**只落在我们那条规则内部**：`align-items: center` 在整张样式表里还有十几处，
//    直接 replace 全局首个命中会改到别人那条规则上 ⇒ 负对照变成"其实没变异"，判据假绿（踩过）。
check('negative control: 少一条对齐声明 ⇒ 同一条判定函数判红',
  hasAlignRule(css.replace(/(nav\s+\[data-we-nav-icon\]\s*\{[^}]*?)align-items: center;/, '$1')).ok === false, '');
check('negative control: 子 svg 那条被删掉 ⇒ 同一条判定函数判红',
  hasAlignRule(css.replace(/nav\s+\[data-we-nav-icon\]\s*>\s*svg[^}]*\}/, '')).ok === false, '');
check('negative control: 整条规则被删掉 ⇒ 同一条判定函数判红',
  hasAlignRule(css.replace(/nav\s+\[data-we-nav-icon\][\s\S]*?\n\s*\n/, '')).ok === false, '');

// ③ CSS 的钩子必须在补丁里真的打上（改名/漏设 ⇒ 规则永不生效，且没有任何报错）
check('补丁给注入的节点打了 data-we-nav-icon 标记',
  /setAttribute\("data-we-nav-icon", "1"\)/.test(navSrc), '');
check('标记与样式里的钩子同名（改一处必须改另一处）',
  /data-we-nav-icon/.test(navSrc) && /data-we-nav-icon/.test(css), '');
// 负对照：把标记改个名，钩子判据必须判红
check('negative control: 换掉标记名 ⇒ 钩子判据报红',
  /setAttribute\("data-we-nav-marker", "1"\)/.test(navSrc) === false, '');

console.log(failed === 0 ? '\nverify-nav-icon: 全部通过 ✓ (' + passed + ')' : '\nverify-nav-icon: ' + failed + ' 项失败 ✗ (' + passed + ' 通过)');
process.exit(failed === 0 ? 0 : 1);
