import SwiftUI
import PhotosUI
import VisionKit
import AVFoundation

struct ScanView: View {
    @EnvironmentObject private var store: ReportStore
    @Environment(\.openURL) private var openURL
    @State private var photo: PhotosPickerItem?
    @State private var showCamera = false
    @State private var busy = false
    @State private var message: String?
    @State private var failure: String?
    @State private var denied = false
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: "doc.viewfinder").font(.system(size: 76)).foregroundStyle(Theme.teal).padding(.top, 30)
                    .accessibilityHidden(true)
                Text("拍下，剩下交给我们").font(.title.bold())
                Text("完整入框 · 光线均匀 · 避免反光\n建议使用文档扫描器自动裁切与校正透视。")
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button { Task { await openCamera() } } label: {
                    Label("拍摄报告", systemImage: "camera").frame(maxWidth: .infinity).padding(8)
                }.buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(busy || store.isImporting || store.loadError != nil || !VNDocumentCameraViewController.isSupported)
                if !VNDocumentCameraViewController.isSupported {
                    Text("当前设备不支持文档相机，请从相册导入。").font(.caption)
                }
                PhotosPicker(selection: $photo, matching: .images, photoLibrary: .shared()) {
                    Label("从相册导入", systemImage: "photo").frame(maxWidth: .infinity).padding(8)
                }.buttonStyle(.bordered).controlSize(.large).disabled(busy || store.isImporting || store.loadError != nil)
                if busy || store.isImporting {
                    ProgressView("正在设备内识别与校验，请保持应用在前台…")
                }
                if let message { Label(message, systemImage: "checkmark.circle").foregroundStyle(Theme.teal) }
                if denied {
                    Button("打开设置，允许相机访问") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                }
                Card {
                    Label("不用手填，也不会猜", systemImage: "lock.shield").font(.headline)
                    Text("核心数据可靠后自动保存。不清晰或矛盾的照片会进入“待识别”，请重拍或换清晰原图。")
                    Text("只支持单人的中文 InBody270 类版式。所有识别与原图保存在本机，不发送到服务器。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }.padding()
        }.background(Theme.background).navigationTitle("扫描报告")
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task {
                    busy = true
                    message = nil
                    defer { busy = false; photo = nil }
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self) else {
                            throw RecordError.recognition("无法从相册读取图片")
                        }
                        message = try await store.importImage(data)
                    } catch { failure = error.localizedDescription }
                }
            }
            .sheet(isPresented: $showCamera) {
                DocumentCamera { result in
                    showCamera = false
                    switch result {
                    case .success(let pages):
                        Task {
                            busy = true
                            message = nil
                            defer { busy = false }
                            var completed = 0
                            do {
                                for page in pages {
                                    _ = try await store.importImage(page)
                                    completed += 1
                                }
                                message = "已处理 \(completed) 页，按测量时间合并。识别范围请查看报告详情。"
                            } catch {
                                failure = "已处理 \(completed) 页，其余未保存。\n\(error.localizedDescription)"
                            }
                        }
                    case .failure(let error): failure = error.localizedDescription
                    }
                }
            }
            .alert("未完成识别或保存", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("知道了", role: .cancel) { }
            } message: { Text(failure ?? "") }
    }
    private func openCamera() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: showCamera = true
        case .notDetermined:
            if await AVCaptureDevice.requestAccess(for: .video) { showCamera = true }
            else { denied = true }
        case .denied, .restricted: denied = true
        @unknown default: failure = "无法确定相机权限，请从相册导入。"
        }
    }
}

struct DocumentCamera: UIViewControllerRepresentable {
    let completion: (Result<[Data], Error>) -> Void
    @Environment(\.dismiss) private var dismiss
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let camera = VNDocumentCameraViewController()
        camera.delegate = context.coordinator
        return camera
    }
    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) { }
    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        private let parent: DocumentCamera
        init(parent: DocumentCamera) { self.parent = parent }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { parent.dismiss() }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            parent.completion(.failure(error))
        }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            var pages: [Data] = []
            for index in 0..<scan.pageCount {
                guard let data = scan.imageOfPage(at: index).jpegData(compressionQuality: 0.95) else {
                    parent.completion(.failure(RecordError.recognition("相机图片无法编码"))); return
                }
                pages.append(data)
            }
            guard !pages.isEmpty else {
                parent.completion(.failure(RecordError.recognition("扫描未返回图片"))); return
            }
            parent.completion(.success(pages))
        }
    }
}
