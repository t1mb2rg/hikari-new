// 里程碑 3 后半的真机实验：这个文件是**故意**失败的，用来让 GitHub 上的 CI 真的红一次。
//
// 它由 Hikari 的执行者在真机上写下、提交并推送（mandate 来自人），实验结束后由人删掉。
// 删掉它的那一次推送会让 CI 回到绿色 —— 两条 run 都留在 GitHub 上，作为这次实验的证据。
import test from 'node:test';
import assert from 'node:assert/strict';

test('真机实验：故意失败', () => {
  assert.equal(1, 2, '这一条是故意写失败的断言');
});
