/**
 * verify-feedback.mjs —— 「反馈」页签的离线判据。
 *
 * 它守四件事（每件都配一条**负对照**，否则解析器一旦静默返回空集，正断言会恒绿）：
 *   ① **页签位置**：\`PICKER_TABS\` 里 \`feedback\` 必须**紧跟在 \`about\` 之后**（用户口径："关于后面加一个反馈"）；
 *   ② **自动探测 + 可改选**：默认跟随"当前正在用的壁纸"，传入别的 id 时模板跟着变；
 *   ③ **模板内容**：必须带现象 / 复现步骤 / 期望 / 环境 / 壁纸（ID · 标题 · 类型）几节，
 *      且**预填 issue 的正文 == 文本框里的模板**（两处同源，不许各写一份）；
 *   ④ **不写设置**：本页签只读设置 —— 渲染器源码里不得出现 setSetting / setTransient
 *      （它是"看一眼、复制走"的静态页，控制项一个都不该有）。
 *
 * 渲染用替身 React **真跑**渲染器（同 verify-presets 的 ④b 套路），断言从渲染树里读；
 * 台架只补作用域（React / weT / adapterDetectedLabel），不替代任何被判定为真的字段。
 *
 * Usage:  node test/verify-feedback.mjs
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

// ── ① 页签位置（数据驱动的那张表）
const clientSrc = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8');
const tabsBlock = clientSrc.slice(clientSrc.indexOf('const PICKER_TABS = ['), clientSrc.indexOf('];', clientSrc.indexOf('const PICKER_TABS = [')));
const ids = [...tabsBlock.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
check('PICKER_TABS 是数据驱动的页签表（解析出 ≥6 个 id）', ids.length >= 6, ids.join(' / '));
// 位置判据抽成纯函数：负对照直接喂**合成输入**给它（对源码做字符串手术太脆：
// 页签项里 \`get label() { … }\` 自带 \`}\`，正则会滑掉 —— 台架自己先踩过一次）。
const tailIsAboutThenFeedback = (list) => list[list.length - 2] === 'about' && list[list.length - 1] === 'feedback';
check('「反馈」紧跟在「关于」之后', tailIsAboutThenFeedback(ids), '尾部两个：' + ids.slice(-2).join(' → '));
check('「反馈」页签的标签走 weT（可翻译）', /id:\s*"feedback",\s*get label\(\) \{ return weT\("反馈"\); \}/.test(tabsBlock), '');
// 位置判据抽成纯函数，负对照直接喂**合成输入**给它（对源码做字符串手术太脆：
// 页签项里 `get label() { … }` 自带 `}`，正则会滑掉 —— 台架自己先踩过一次）。
check('negative control: 「反馈」在「关于」之前 ⇒ 同一条判据报红',
  tailIsAboutThenFeedback(['library', 'extensions', 'feedback', 'about']) === false, '');
check('negative control: 少一个页签（只有 about 收尾）⇒ 同一条判据报红',
  tailIsAboutThenFeedback(['library', 'about']) === false, '');

// ── ④ 不写设置（源码级禁令，先做：它扫的就是渲染器本体）
const tabsSrc = readFileSync(join(ROOT, 'src', 'panel-tabs.js'), 'utf8');
const fbStart = tabsSrc.indexOf('function renderFeedbackTab(ctx)');
const fbEnd = tabsSrc.indexOf('export {', fbStart);
const fbSrc = fbStart >= 0 && fbEnd > fbStart ? tabsSrc.slice(fbStart, fbEnd) : '';
check('找得到 renderFeedbackTab 的函数体（锚点没漂）', fbSrc.length > 500, fbSrc.length + ' 字符');
check('本页签不写设置（无 setSetting / setTransient）', fbSrc.length > 0 && !/setSetting\(|setTransient\(/.test(fbSrc), '');
check('negative control: 往函数体里塞一句 setSetting ⇒ 同一条判据报红',
  /setSetting\(/.test(fbSrc + ' setSetting(1)') === true, '');
check('渲染器首行从 ctx 解构（verify-scene-live 的形状要求）', /function renderFeedbackTab\(ctx\) \{\s*\n\s*const \{/.test(tabsSrc), '');

// ── 真渲染：替身 React + 真源码
const ReactStub = {
  // ⚠️ 必须像 React 一样**摊平数组子节点**：`items.map(...)` 是一个数组 child，
  //    不平铺的话"下拉里有两张壁纸"这类判据读到的是 1 个数组而不是 N 个 option（台架假红）。
  createElement: (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity).filter((c) => c !== undefined && c !== null && c !== false),
  }),
  Fragment: '@fragment',
};
const weTStub = (k, params) => {
  let out = String(k);
  if (params) for (const [name, v] of Object.entries(params)) out = out.split('{' + name + '}').join(String(v));
  return out;
};
const stub = {
  React: ReactStub,
  weT: weTStub,
  adapterDetectedLabel: () => '官方桌面端',
  // 渲染器只用到上面三个跨模块符号；其余同名符号在真 bundle 里由内联提供，这里不需要。
};
const src = tabsSrc.replace(/export\s*\{[^}]*\};?/g, '');
const make = new Function(...Object.keys(stub), src + ';return { renderFeedbackTab, feedbackTemplateLines };');
const { renderFeedbackTab } = make(...Object.keys(stub).map((k) => stub[k]));

// 走一遍渲染树，把某个 type 的节点全收集起来
const collect = (node, type, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.type === type) out.push(node);
  for (const c of node.children || []) collect(c, type, out);
  return out;
};
const CUR = { id: '3441873795', title: 'Swimming Kirby [4K]', type: 'scene' };
const LIST = [CUR, { id: '123', title: 'Another', type: 'video' }];
const render = (pickedId, copied) => renderFeedbackTab({
  current: CUR, wallpapers: LIST, pickedId, onPickId: () => {}, copyState: copied,
  onCopyTemplate: () => {}, repoUrl: 'https://github.com/elysia395/dsh-wallpaper-engine',
});

const treeAuto = render('', '');
const taAuto = collect(treeAuto, 'textarea')[0];
const textAuto = taAuto ? taAuto.props.value : '';
check('渲染出模板文本框', !!taAuto && typeof textAuto === 'string' && textAuto.length > 100, (textAuto || '').length + ' 字符');
for (const [name, needle] of [
  ['现象', '## 现象'], ['复现步骤', '## 复现步骤'], ['期望', '## 期望'],
  ['环境', '## 环境'], ['壁纸', '## 壁纸'], ['诊断', '## 诊断'],
]) check('模板含「' + name + '」小节', textAuto.indexOf(needle) >= 0, needle);

// ② 自动探测：pickedId 为空 ⇒ 跟随当前壁纸（current 的 id/title/type 出现在模板里）
check('pickedId 为空时自动填当前壁纸的 ID / 标题 / 类型',
  textAuto.indexOf('3441873795') >= 0 && textAuto.indexOf('Swimming Kirby [4K]') >= 0 && textAuto.indexOf('scene') >= 0, '');
const treePicked = render('123', '');
const textPicked = collect(treePicked, 'textarea')[0].props.value;
check('改选成另一张后模板跟着变（ID 与标题都要换）',
  textPicked.indexOf('123') >= 0 && textPicked.indexOf('Another') >= 0 && textPicked.indexOf('3441873795') < 0, '');
check('下拉里两档都在（跟随当前 + 每张壁纸）', collect(treeAuto, 'select')[0].children.length === 1 + LIST.length,
  collect(treeAuto, 'select')[0].children.length + ' 档');

// ③ 预填 issue：href 的 body 必须与文本框同源
const link = collect(treeAuto, 'a')[0];
const href = link ? String(link.props.href) : '';
const bodyParam = href.slice(href.indexOf('body=') + 5);
check('有「去 GitHub 新建 issue」按钮且指向 issues/new', /^https:\/\/github\.com\/elysia395\/dsh-wallpaper-engine\/issues\/new\?title=/.test(href), href.slice(0, 96));
check('预填正文 == 文本框里的模板（两处同源）', decodeURIComponent(bodyParam) === textAuto, '');
// 负对照：把模板换掉一个字符，同一条"同源"判据必须判红
check('negative control: 模板与 href 正文不一致时会被判出',
  decodeURIComponent(bodyParam + '%20x') !== textAuto, '');

// 复制按钮：点一下把**文本框里的那份**交出去
let copiedText = null;
const treeCopy = renderFeedbackTab({
  current: CUR, wallpapers: LIST, pickedId: '', onPickId: () => {}, copyState: '',
  onCopyTemplate: (t) => { copiedText = t; }, repoUrl: 'https://github.com/elysia395/dsh-wallpaper-engine',
});
const copyBtn = collect(treeCopy, 'button').find((b) => /复制模板/.test(JSON.stringify(b.children)));
check('有「复制模板」按钮', !!copyBtn, '');
if (copyBtn) copyBtn.props.onClick();
check('点复制交出去的就是文本框里那份模板', copiedText === collect(treeCopy, 'textarea')[0].props.value, '');

// 回执两态都要画得出来（成功 / 失败各一条文案）
const okTree = JSON.stringify(render('', 'ok'));
const failTree = JSON.stringify(render('', 'fail'));
check('复制成功有回执', /已复制到剪贴板/.test(okTree), '');
check('复制失败有回执（且提示手动复制）', /复制失败/.test(failTree) && /手动选中/.test(failTree), '');


// ── ④b 刷新路径：停在「反馈」页刷新页面时，activeTab 直接从 localStorage 读出来、不走 switchTab，
//        靠一条 effect 兜住（与「关于」页 star 数同款）。源码级钉形态，改写法要同步改这里。
check('停在「反馈」页刷新也拉一次诊断（effect 兜住不走 switchTab 的那条路径）',
  /React\.useEffect\(\(\) => \{ if \(activeTab === "feedback"\) loadFeedbackDiag\(false\); \}, \[activeTab\]\);/.test(clientSrc), '');
check('switchTab 里也接了「反馈」（切页签时拉一次）',
  /if \(id === "feedback"\) loadFeedbackDiag\(false\);/.test(clientSrc), '');

// ── ⑤ 自动填：插件版本（构建期注入）+ 诊断（宿主环形缓冲，脱敏 + 截断）──────────────
// 这两样是"用户不用管"的部分 —— 也正是最容易悄悄失效的部分（版本注入断了只是空白、
// 诊断取不到只是空段），所以每条都要有正断言与负对照。
const renderFull = (extra) => renderFeedbackTab(Object.assign({
  current: CUR, wallpapers: LIST, pickedId: '', onPickId: () => {}, copyState: '',
  onCopyTemplate: () => {}, repoUrl: 'https://github.com/elysia395/dsh-wallpaper-engine',
}, extra || {}));
const textOf = (tree) => { const ta = collect(tree, 'textarea')[0]; return ta ? String(ta.props.value || '') : ''; };

// ① 版本：ctx 里给什么就填什么（渲染器不许自己编）
const withVer = textOf(renderFull({ pluginVersion: '9.9.9' }));
check('插件版本必须自动填进模板', withVer.includes('- 插件版本：9.9.9'), '');
const withoutVer = textOf(renderFull({ pluginVersion: '' }));
check('版本取不到时给的是"可在设置里查看"的提示，而不是空白',
  withoutVer.includes('- 插件版本：（取不到'), '实得：' + withoutVer.split('\n').filter((l) => l.includes('插件版本'))[0]);
check('negative control: 版本号没进模板会被同一条判据判出',
  withVer.includes('- 插件版本：9.9.9') && !withoutVer.includes('- 插件版本：9.9.9'), '');

// ② 诊断：自动附带 + 脱敏 + 只留最近 20 行
const now = Date.now();
const SECRET = 'SECRETTOKENVALUE123456';
const diagEntries = [
  { t: now - 90000, msg: '最早的一条：不该进模板' },
  ...Array.from({ length: 25 }, (_, i) => ({ t: now - 20000 + i * 100, msg: 'warn line ' + i })),
  { t: now, msg: 'GET /wallpaper-engine/live-frame?token=' + SECRET + ' 403' },
];
const withDiag = textOf(renderFull({ diagEntries }));
check('诊断必须自动附进模板', withDiag.includes('warn line 24') && withDiag.includes('403'), '');
check('诊断里带凭据的地址必须**自动打码**（不许把 token 贴进公开 issue）',
  !withDiag.includes(SECRET) && withDiag.includes('token=***'), withDiag.includes(SECRET) ? '明文仍在！' : '');
check('诊断只留最近 20 行（30 条输入里最老的那条不该出现）',
  !withDiag.includes('最早的一条：不该进模板'), '');
const emptyDiag = textOf(renderFull({ diagEntries: [] }));
check('诊断为空时给一句人话而不是空白', /（暂时没取到|暂时是空的/.test(emptyDiag), '');

// ③ 诊断区块与按钮真的画出来了
const diagTree = renderFull({ diagEntries, diagBusy: false });
check('页面上有诊断框（we-feedback__diag）', collect(diagTree, 'pre').some((n) => String(n.props.className || '').includes('we-feedback__diag')), '');
const btnText = (t) => JSON.stringify(diagTree).includes(t);
check('有「刷新诊断」与「复制诊断」按钮', btnText('刷新诊断') && btnText('复制诊断'), '');

// ④ 构建期注入必须真的在产物与构建脚本里（版本号断了只会显示空白，没人会发现）
const buildSrc = readFileSync(join(ROOT, 'scripts', 'build-client.mjs'), 'utf8');
const builtSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
check('构建脚本按 package.json 注入 WE_PLUGIN_VERSION', /WE_PLUGIN_VERSION = \$\{JSON\.stringify\(pkg\.version\)\}/.test(buildSrc), '');
check('产物里带注入的版本号（与 package.json 一致）',
  builtSrc.includes('var WE_PLUGIN_VERSION = ' + JSON.stringify(pkgVersion)), pkgVersion);
check('客户端读版本走了 typeof 守卫（单独 eval 本文件时不会 ReferenceError）',
  /typeof WE_PLUGIN_VERSION === "string"/.test(readFileSync(join(ROOT, 'src', 'client.js'), 'utf8')), '');

console.log(failed === 0 ? '\nverify-feedback: 全部通过 ✓ (' + passed + ')' : '\nverify-feedback: ' + failed + ' 项失败 ✗ (' + passed + ' 通过)');
process.exit(failed === 0 ? 0 : 1);
