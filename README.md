# 移动端网页原型

这是无需 Android SDK、APK、npm 或服务器的本地 HTML/JavaScript 移动应用。桌面程序保持不变。请将整个 `mobile` 文件夹放在一起使用，其中的 `js/` 和 `data/` 是运行必需资源。

## 在手机上验证录音

1. 将整个 `mobile` 文件夹复制到 Android 手机上。
2. 从文件管理器找到 `index.html`，选择 Chrome 或目标浏览器打开。
3. 首次允许麦克风权限后，点录音输入旁的刷新按钮，再选择外置 USB 声卡。选择后“选择”状态会显示设备名；录音状态会显示浏览器实际打开的输入和设备 ID 诊断。
4. 播放外部设备的音频，检查电平、实际输入名称、采样率、静音/削波状态。选择具体设备时应用请求浏览器精确匹配该输入；实际设备 ID 不同或浏览器不提供实际 ID 时会停止录音，不会静默改用默认麦克风。已选设备断开时也会保留为“已断开”，不会自动切到默认输入。
5. 录音结束后页面会本地计算声音类别、置信度并筛选候选物品；可播放该类别的参考音，或导出 `mobile-capture.wav`。

如果页面提示浏览器不允许麦克风，先确认浏览器对本地文件的麦克风权限。不同手机、文件管理器和浏览器对 `file://` 的处理可能不同；该情况下可改为通过 localhost 或 HTTPS 打开静态页面，仍然不需要 Android SDK。

## 当前范围

- 已实现：浏览器麦克风权限请求、音频输入选择、优先双声道的固定 5 秒 PCM 采集、实时分声道电平与峰值检测、保留左右声道的 WAV 导出。识别使用录音期间 RMS 更高的声道，避免 USB Line-In 信号只在左/右单边时被下混丢失。
- 已实现：纯 JavaScript 重采样、Butterworth SOS 零相位带通、事件切分、MFCC/CMVN、FastDTW/L1 距离和分类置信度。
- 已实现：本地预计算模板、声音/物品类别/占用格式三重筛选、品质排序和参考 WAV 试听。
- 已验证：21 个 Python 黄金用例通过端到端分类回归；10 个打包参考音在运行资源中的自识别全部正确。
- 尚未实现：学习样本保存/删除/上限、IndexedDB 持久化与备份、用户学习特征重建、手动重置识别类别。
- 不计划做：Android SDK/APK、PWA 安装和后台录音。
- 音频仅在页面内存处理；只有点击 WAV 导出后才会下载录音，不会上传。

## 匹配器回归测试

黄金语料位于 `tests/`，包含 21 个 WAV 输入及 Python 计算的重采样/滤波/事件 PCM/MFCC/参考模板特征。自身匹配用例用于算法回归，不代表实际分类准确率。

在仓库根目录执行：

```powershell
uv run python mobile/tools/verify_golden_matches.py
node mobile/tools/verify_matcher_core.cjs
node mobile/tools/verify_mfcc.cjs
node mobile/tools/verify_end_to_end.cjs
node mobile/tools/verify_web_assets.cjs
```

如果桌面 Python 匹配算法的预期行为有意变更，再重新生成夹具：

```powershell
uv run python mobile/tools/export_golden_matches.py
```

生成脚本会覆盖 `tests/golden-matches.json` 和 `tests/audio/` 中的固定样本；常规验证不需要重新生成。

更新参考 WAV、物品映射或桌面模板后，重建随网页包分发的资源并验证：

```powershell
uv run python mobile/tools/export_web_assets.py
node mobile/tools/verify_web_assets.cjs
```

`data/audio-assets.js` 内嵌特征、映射和参考 WAV，使本地 `file://` 页面不必通过 `fetch` 读取 JSON/WAV。

## 桌面浏览器检查

在仓库根目录可直接打开 `mobile/index.html`。运行时不访问网络，但页面会加载同一 `mobile` 文件夹内的 JS/数据文件，不能只单独复制 HTML。移动端麦克风路由已由用户实测；分类准确率仍需用真实拾取声持续评估。
