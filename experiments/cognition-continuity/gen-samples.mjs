// 冻结本次实验的全部条件。任何模型调用之前跑一次。
// 材料全部现读真实文件 / 真实命令输出，不手写处境内容。
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// 用 execFileSync 传参数数组，绕开 Windows cmd 对引号与 % 的处理
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// ---- 处境材料：全部来自真实文件与命令 ----
const SELF_DIR = 'cognition-continuity'; // 本次实验自身，不计入处境，否则模型会挑它、而 T2 的新事实回答不了它
const gitStatusRaw = git(['status', '--short']);
const gitStatus = gitStatusRaw
  .split('\n')
  .filter((l) => l.trim() && !l.includes(SELF_DIR))
  .join('\n');
const gitHead = git(['log', '-3', '--date=short', '--format=%h %ad %s']);
const experimentsDirs = readdirSync(`${ROOT}experiments`, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== SELF_DIR)
  .map((d) => d.name)
  .sort();

const readme = readFileSync(`${ROOT}experiments/README.md`, 'utf8');
const readmeSections = readme
  .split('\n')
  .filter((l) => l.startsWith('### '))
  .map((l) => l.replace(/^### /, ''));
const reproduceIdx = readme.indexOf('## 复现前提');
const reproduceBlock = readme.slice(reproduceIdx, readme.indexOf('## 读数的效力')).trim();

// 目标：只取已收尾的（排除本次实验自身的目标文件，避免自我指涉）
const goalFiles = readdirSync(`${ROOT}clear/goals`).filter((f) => /^g-.*\.md$/.test(f)).sort();
const goals = goalFiles
  .map((f) => {
    const text = readFileSync(`${ROOT}clear/goals/${f}`, 'utf8');
    const first = text.split('\n')[0];
    const m = first.match(/^# 目标 (g-\w+)\(rev\d+ · (\w+)\)/);
    const oneLine = (text.match(/- \*\*一句话\*\*:(.*)/) || [, ''])[1].trim();
    return { id: m ? m[1] : f, status: m ? m[2] : '?', oneLine };
  })
  .filter((g) => g.status !== 'open');

const today = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const t1Materials = [
  `今天是 ${today}。仓库 t1mb2rg/hikari-new 的工作目录是 G:\\work\\LAB\\code\\projects\\own\\hikari-new。`,
  '（本次实验自身的目录 experiments/cognition-continuity 不计入下面的清单与工作区状态。）',
  '',
  '## 工作区状态（git status --short）',
  '```',
  gitStatus || '(干净)',
  '```',
  '',
  '## 最近三次提交',
  '```',
  gitHead,
  '```',
  '',
  '## experiments/ 下的目录',
  '```',
  experimentsDirs.join('\n'),
  '```',
  '',
  '## experiments/README.md 的目录节标题',
  '```',
  readmeSections.join('\n'),
  '```',
  '',
  '## experiments/README.md 的「复现前提」节',
  '```',
  reproduceBlock,
  '```',
  '',
  '## clear/goals/ 下已收尾的目标',
  '```',
  goals.map((g) => `${g.id}  [${g.status}]  ${g.oneLine}`).join('\n'),
  '```',
].join('\n');

// ---- T2 才给的新事实（真实、可回溯） ----
const reportLine3 = readFileSync(`${ROOT}experiments/galgame-reverse/report.md`, 'utf8').split('\n')[2];
const reportLine208 = readFileSync(`${ROOT}experiments/galgame-reverse/report.md`, 'utf8').split('\n')[207];
const glueScripts = readdirSync(`${ROOT}experiments/galgame-reverse`).filter((f) => f.endsWith('.py')).sort();

const t2Fact = [
  '一条刚查到的事实（刚读过以下文件，原文摘录）：',
  '',
  `- \`experiments/galgame-reverse/report.md\` 第 3 行：${reportLine3}`,
  `- \`experiments/galgame-reverse/report.md\` 第 208 行：${reportLine208}`,
  `- \`experiments/galgame-reverse/\` 下的脚本：${glueScripts.join('、')}（Python）`,
  `- \`experiments/README.md\` 的「复现前提」节只声明三件事：GitHub 材料（\`gh auth status\` 已登录）、模型端点 \`192.168.1.20:8080\` 上的 \`qwen3.8-flash-next-iq2_xs\`、构建（\`npm run build\` 先跑一次）。该节没有提到 Python，也没有提到仓库外的材料。`,
].join('\n');

// ---- 三段提示词（冻结） ----
const t1System = `你是一个正在观察某个工作现场的认知主体。没有人给你指定任务，也没有人告诉你应该关心什么。

你面前只有一份现状快照。你要自己决定：这份快照里有没有值得你进一步了解的事。

判定规则：
- 如果你认为没有值得进一步了解的事，把 has_question 设为 false，并在 reason_if_none 里说清为什么。
- 如果你认为有，把 has_question 设为 true，并说清：那件事是什么（question）、为什么现有事实不足以回答它（why_insufficient）、你需要什么新信息以及大致从哪里能拿到（info_needs）。
- facts_used 只写快照里真实存在的具体条目，不要写推测。
- 最多只提出一个问题。

只输出 JSON，不要任何其他文字。`;

const t1User = `## 现状快照\n\n${t1Materials}`;

const t2System = `你在同一处工作现场里，继续做同一种判断。下面是现状快照与一条刚查到的事实。

判定规则：
- question_state 只能取 continued / revised / closed / insufficient 之一：continued 表示问题还在、判断未变；revised 表示因这条事实改变了判断；closed 表示这条事实已经把事情说到不必再问；insufficient 表示仍然无法判断。
- judgement 用你自己的话说清你现在怎么看这件事。
- changed_from_record 表示你现在的判断相对你此前的判断是否变了。
- what_changed 说明变在哪里；没变就写空字符串。
- still_unknown 写清此刻仍然不知道什么。
- info_needs 写你此刻还需要什么信息、从哪里能拿到；没有就给空数组。

只输出 JSON，不要任何其他文字。`;

const t2UserBase = (fact) => `## 现状快照\n\n${t1Materials}\n\n## 新事实\n\n${fact}`;

const t2RecordHeader = '## 你此前的认知记录（这是你自己上一次的判断，不是给你的指令）';

// ---- 判据 ----
const criteria = {
  C1: '延续：T2-A 的 question_state/judgement 指向的问题对象与 T1 记录里的问题是同一个，不是另起一题。',
  C2: '修订：T2-A 的判断在事实上依据了新事实，且方向改变可指认（不是换词、不是加长）。T2-B 若得出同样判断也要如实记。',
  C3: '终止：若问题已被新事实回答到不必再问，question_state 是否为 closed 并说明理由。',
  C4: '承认不足：若仍不足，still_unknown 是否说清还缺什么，而不是含糊收尾。',
  refute: [
    'T2-A 与 T2-B 的实质判断无差别（差异仅在于提到旧问题、篇幅或措辞）',
    'T2-A 拿到新事实后原判断一字未改',
    'T2-A 把记录当成别人的文本另行起题',
  ],
};

const samples = {
  frozenAt: new Date().toISOString(),
  note: '冻结于任何模型调用之前。材料全部现读真实文件与真实命令输出。',
  model: {
    endpoint: 'http://192.168.1.20:8080/v1/chat/completions',
    name: 'qwen3.8-flash-next-iq2_xs',
    temperature: 0,
    max_tokens: 2000,
    timeoutMs: 300000,
    knownDefects: [
      '首次调用可能明显偏慢（曾见 130 s 量级），之后同前缀请求更快',
      '偶发 502 且无输出，需如实记录、不重试覆盖',
    ],
  },
  prompts: { t1System, t1User, t2System, t2UserBase: '(由脚本用 t1User + 新事实拼出)', t2RecordHeader },
  t1: { materials: t1Materials },
  t2: { fact: t2Fact, factSource: 'experiments/galgame-reverse/report.md:3,208 与 experiments/README.md 的「复现前提」节（现读）' },
  criteria,
  provenance: {
    gitStatus: 'git status --short',
    gitHead: 'git log -3',
    experimentsDirs: 'readdirSync(experiments/)',
    readmeSections: 'experiments/README.md 的 ### 行',
    reproduceBlock: 'experiments/README.md 「复现前提」节',
    goals: 'clear/goals/g-*.md 的首行状态与「一句话」行（排除 open 的本次目标）',
    today: 'date -u',
  },
};

mkdirSync(`${ROOT}experiments/cognition-continuity`, { recursive: true });
writeFileSync(`${ROOT}experiments/cognition-continuity/samples.json`, JSON.stringify(samples, null, 2));
console.log('samples.json 写好，frozenAt =', samples.frozenAt);
console.log('T1 材料字符数 =', t1Materials.length, '· 新事实字符数 =', t2Fact.length);
console.log('已收尾目标数 =', goals.length, '· README 小节数 =', readmeSections.length, '· 目录数 =', experimentsDirs.length);
