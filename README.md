# 身体记录 · 原生 iOS

SwiftUI iOS 17+ 原生工程：拍摄或相册导入中文 InBody270 类报告，在设备内执行 Apple Vision OCR，空间解析及一致性校验后自动保存，查看各个实际识别指标的历史趋势。无账户、付费 API、云识别、后台服务或手填入口。

**开发状态：尚未完成 Xcode 编译与原生运行验证。源码、合成测试和 CI 配置不是测试已通过的证明。**

## 本地运行

Xcode 15+ 打开 `InBodyTrends.xcodeproj`，选择 `InBodyTrends` scheme 和 iOS 17+ iPhone 模拟器。真机需选择自己的签名 Team 和唯一 Bundle Identifier；模拟器用相册导入，文档相机只适用于支持的真机。

首次启动为空。概览显示最近测量与差异；扫描使用系统文档相机或照片选择器；趋势按测量时间排列；报告提供原图、待识别状态、识别范围、CSV 导出与删除。

打开 [中文 iPhone 视觉预览](Design/preview.html) 或 [设计说明](Design/设计与研究.md)。所有预览数字和曲线均独立合成，不是个人报告，也不运行 iOS、相机或 OCR。

## 原生 macOS CI

`.github/workflows/ios-validation.yml` 只允许 **workflow_dispatch 手动触发**，不因 push 或 PR 自动运行；使用标准 GitHub-hosted `macos-15`，不是 larger runner。私有仓库会跳过该作业以避免意外使用私有额度。权限只有 `contents: read`，checkout 不保留凭据；作业最长 35 分钟，同时新运行取消旧运行。

CI 顺序：

1. 检查公开文件边界，拒绝私有照片、标注、日志、旧 ZIP 和未知二进制。
2. 使用 AppKit 在 runner 内绘制四张**独立合成的中文报告 PNG**：正常报告、日期缺失、骨骼肌缺失和正文/图表矛盾。图片不是 OCR 文本代理，也不来自任何用户照片。
3. 从实际安装的 runtime/device 清单选择可用 iOS 17+ iPhone 模拟器并等待启动，不硬编码机型或 UDID。
4. 执行真正的 `xcodebuild build` 和 `xcodebuild test`，设置 `CODE_SIGNING_ALLOWED=NO`。
5. XCTest 把 PNG 字节送入应用的 `LocalOCR`（Apple Vision）和 `ReportParser`，核对日期、核心指标、评分及人体成分，验证多列/刻度/参考区间干扰与三个拒绝路径。
6. 检查 `.xcresult`，四个合成 OCR 方法必须实际出现且全部 Passed；缺图、跳过、丢失、失败或重复都不能算成功。

配置不上传 build/test artifacts，不使用 Actions cache、付费 API、部署或自动提交。运行日志仍受 GitHub 自身保留政策控制，公开仓库的日志也可能公开，因此只运行合成数据。

[GitHub 官方计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)说明：公开仓库的标准 GitHub-hosted runner 不消耗私人 included compute；larger runner 即使公开仓库也收费。这不代表用户账户余额已检查，也不涵盖任何将来启用的额外存储/付费服务。

**本轮仅本地准备，未创建远端、push、上传或运行此 workflow。须先授权公开，再授权运行 CI，才能获得真正原生结果；失败后仍需根据实际日志修复。**

## 开发测试

在有 Xcode 的 macOS 上：

```sh
swift Tools/GenerateSyntheticReports.swift Tests/Resources/SyntheticFixtures
python3 Tools/select_simulator.py --boot
```

之后在 Xcode 按 ⌘U，或使用 CI 同样的 `xcodebuild` 命令和工具输出的实际模拟器 ID。缺少合成 PNG 时测试会失败，不会跳过。可用 Swift 5.9+ 单独执行 `swift test` 来验证核心解析与合并；这不执行图片 OCR。

Windows 上可执行的辅助检查：

```sh
python -m unittest discover -s Tools -p test_ci_tools.py
python -m pip install tree-sitter tree-sitter-swift openstep-parser
python Tools/validate.py
python Tools/check_public_tree.py
```

这些仅检查 Python 选择/结果守卫逻辑、Swift 语法、Xcode 引用及文件边界，**不是 Swift 类型检查、XCTest、Apple Vision 或真机验收**。

增删 Swift 文件后可以 `python3 Tools/generate_project.py` 重建工程，不需要额外工程生成器。

## 识别与隐私边界

- 必须可靠识别测量日期/时间及体重、骨骼肌、体脂肪、BMI、体脂率；缺失或矛盾进入待识别，不能手填或猜值。
- 利用文字子串坐标、分区、单位和字体大小排除参考区间及刻度，交叉校验脂肪重量/体脂率、可用的人体成分总和、去脂体重及身高/BMI。
- 可选指标仅在可靠时保存，包括评分、人体成分、体重控制、研究项目、部分分段数据及阻抗；详情明确未识别项目，不能保证所有机型与模糊照片都支持。
- 底部历史只可能补齐体重、骨骼肌、体脂率；日期/时间/列位置模糊则跳过。其他数值不反推、不补零。
- 同次测量合并，完整报告优先于历史摘要；矛盾的完整报告不覆盖。完全相同照片去重。适合单人记录，不能自动区分多个人。
- 图表单点不制造趋势，体脂率变化以百分点表示。报告无时区时保留墙上时间，不猜时区。
- 原图与 JSON 在应用私有文件夹保存，完整文件保护、备份排除与后台遮盖；OCR 全文不落盘。卸载可能丢失记录。
- CSV 只导出识别值/单位/测量时间/来源标识，不含原图和报告 ID；导出文件由用户自行保护。可删除单次、待识别或全部数据。
- 不导出医疗诊断、治疗或饮食处方；测量条件影响结果，变化不是好坏判断。

## CI 的限制

模拟器编译和合成图片测试即使通过，也不能证明相机权限、真实照片 OCR 准确率、真机文件保护/备份/任务快照、设备性能或 App Store 发布已通过。仍需真机和独立本地私有资料验收。此公开工程不包含任何真实报告、其人工标注、日志或私有图片测试。
