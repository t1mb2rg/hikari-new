// 机械摘要：严格按 samples.json 的 digestRules 从材料抽取，零模型。
//
// 这个模块只用于实验，不接入产品。它的作用是回答「不用模型能拿到多少」，
// 所以规则必须是可机械执行的：不判断原因、不提建议、不概括跨 job 关系。

// 真实日志每行都带时间戳前缀（`2026-10-15T15:58:49.9474551Z …`），所以失败标记
// 不在行首。MD-3 的冻结文本写的是「按行序找第一个匹配的行」，这里按该语义实现，
// 正则不锚定行首——见 samples.json 的 amendments[MD-3]。
const FIRST_FAILURE_MARKER = /##\[error\]|\bnot ok \d|✖ /;

/** @param {import('../../dist/github-ci/materials.js').GitHubCiRunMaterials} materials */
export function mechanicalDigest(materials) {
  return [md1(materials), md2(materials), md3(materials)].join('\n');
}

// MD-1 失败位置：失败 job 与其失败 step，按返回顺序。
function md1(materials) {
  const jobs = materials.jobs.kind === 'present' ? materials.jobs.value : [];
  const failed = jobs.filter((job) => job.conclusion === 'failure');
  if (failed.length === 0) return '失败位置：（无失败 job）';
  const parts = failed.map((job) => {
    const steps = job.steps.filter((step) => step.conclusion === 'failure').map((step) => step.name);
    return steps.length === 0 ? `${job.name} / （无失败 step）` : `${job.name} / ${steps.join('、')}`;
  });
  return `失败位置：${parts.join('；')}`;
}

// MD-2 改动文件：前 3 个路径，超过 3 个加「等 N 个」。
function md2(materials) {
  if (materials.changedFiles.kind !== 'present') return '改动文件：（无改动文件）';
  const { files, totalFiles } = materials.changedFiles.value;
  if (files.length === 0) return '改动文件：（无改动文件）';
  const shown = files.slice(0, 3).map((file) => file.filename);
  const suffix = totalFiles > 3 ? ` 等 ${totalFiles} 个` : '';
  return `改动文件：${shown.join('、')}${suffix}`;
}

// MD-3 日志首行失败标记：按行序找第一个匹配的行原文，截断到 200 字符。
function md3(materials) {
  if (materials.log.kind !== 'present') return '日志首行：（没有日志材料）';
  for (const line of materials.log.value.text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!FIRST_FAILURE_MARKER.test(trimmed)) continue;
    const text = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    return `日志首行：${text}`;
  }
  return '日志首行：（日志里没有找到失败标记）';
}
