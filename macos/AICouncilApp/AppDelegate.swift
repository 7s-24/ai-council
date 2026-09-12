import AppKit
import Security
import WebKit

private struct BuildConfig {
    let workspacePath: String
    let nodePath: String
    let toolPath: String

    static func load() -> BuildConfig? {
        guard
            let url = Bundle.main.url(forResource: "AppConfig", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let value = try? PropertyListSerialization.propertyList(from: data, format: nil),
            let dictionary = value as? [String: Any],
            let workspacePath = dictionary["WorkspacePath"] as? String,
            let nodePath = dictionary["NodePath"] as? String,
            let toolPath = dictionary["ToolPath"] as? String
        else { return nil }
        return BuildConfig(workspacePath: workspacePath, nodePath: nodePath, toolPath: toolPath)
    }
}

/// Where a window should land once the local service is up. A window created
/// before the server is ready remembers this and loads as soon as it can.
private struct ChatDestination {
    var projectID: String = ""
    var sessionID: String = ""
    var fresh: Bool = false

    func url(base: URL, token: String) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        var items = [URLQueryItem(name: "token", value: token)]
        if !projectID.isEmpty { items.append(URLQueryItem(name: "project", value: projectID)) }
        if !sessionID.isEmpty {
            items.append(URLQueryItem(name: "session", value: sessionID))
        } else if fresh {
            items.append(URLQueryItem(name: "new", value: "1"))
        }
        components?.queryItems = items
        return components?.url ?? base
    }
}

/// One window, one WKWebView, one pinned chat session. Every window talks to
/// the same local service, so several conversations in the same folder can run
/// side by side.
private final class ChatWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let window: NSWindow
    let webView: WKWebView
    var destination: ChatDestination
    private weak var owner: AppDelegate?
    private var loaded = false

    init(destination: ChatDestination, owner: AppDelegate, title: String, dark: Bool) {
        self.destination = destination
        self.owner = owner

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        super.init()

        configuration.userContentController.add(self, name: "aiCouncil")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.title = title
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        webView.appearance = window.appearance
        window.minSize = NSSize(width: 980, height: 650)
        // Let macOS group review rooms into tabs the way Finder or Safari does.
        window.tabbingMode = .preferred
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
    }

    func show(cascadingFrom previous: ChatWindow?) {
        if let previous {
            let origin = previous.window.cascadeTopLeft(from: .zero)
            window.cascadeTopLeft(from: origin)
        } else {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
    }

    func load(base: URL, token: String) {
        loaded = true
        webView.load(URLRequest(url: destination.url(base: base, token: token)))
    }

    var hasLoaded: Bool { loaded }

    func reset() {
        loaded = false
    }

    func showStatus(_ html: String) {
        loaded = false
        webView.loadHTMLString(html, baseURL: nil)
    }

    func apply(appearance: NSAppearance?) {
        window.appearance = appearance
        webView.appearance = appearance
    }

    func evaluate(_ script: String) {
        guard loaded else { return }
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func windowWillClose(_ notification: Notification) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "aiCouncil")
        owner?.chatWindowDidClose(self)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "aiCouncil",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        owner?.handleBridge(action: action, body: body, from: self)
    }

    // WKWebView does not present JavaScript dialogs on its own. These sheets
    // keep session rename/delete usable in the native app as well as a browser.
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: NSLocalizedString("OK", comment: "Confirm action"))
        alert.addButton(withTitle: NSLocalizedString("Cancel", comment: "Cancel action"))
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: NSLocalizedString("OK", comment: "Confirm action"))
        alert.addButton(withTitle: NSLocalizedString("Cancel", comment: "Cancel action"))
        let input = NSTextField(string: defaultText ?? "")
        input.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        alert.accessoryView = input
        alert.window.initialFirstResponder = input
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let isLocal = url.host == "127.0.0.1" || url.scheme == "about" || url.scheme == "data"
        if isLocal {
            decisionHandler(.allow)
        } else if navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.cancel)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var chatWindows: [ChatWindow] = []
    private var serverProcess: Process?
    private var serverPipe: Pipe?
    private var readyFileURL: URL?
    private var outputBuffer = ""
    private var workspaceURL: URL!
    private var projectsRootURL: URL!
    private var scopedProjectsRootURL: URL?
    private var additionalProjectURLs: [URL] = []
    private var scopedAdditionalProjectURLs: [URL] = []
    private var nodeURL: URL!
    private var toolPath = ""
    private var serverURL: URL?
    private var accessToken = ""
    private var language = UserDefaults.standard.string(forKey: "language") == "en" ? "en" : "zh"
    private var theme = UserDefaults.standard.string(forKey: "theme") == "dark" ? "dark" : "light"
    private var isTerminating = false
    private var serverStarted = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureMenus()
        _ = makeChatWindow(destination: ChatDestination())

        guard configureRuntime() else {
            showStartupFailure(localized("找不到有效的 AI Council workspace。", "No valid AI Council workspace was found."))
            return
        }

        NSApp.activate(ignoringOtherApps: true)
        if restoreProjectsRootAccess() {
            restoreAdditionalProjectAccess()
            startServer()
        } else {
            chooseProjectsRoot(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        stopServer(wait: true)
        scopedProjectsRootURL?.stopAccessingSecurityScopedResource()
        scopedAdditionalProjectURLs.forEach { $0.stopAccessingSecurityScopedResource() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            if let existing = chatWindows.last {
                existing.window.makeKeyAndOrderFront(nil)
            } else {
                openChatWindow(destination: ChatDestination(fresh: false))
            }
        }
        return true
    }

    private func localized(_ chinese: String, _ english: String) -> String {
        language == "en" ? english : chinese
    }

    private var windowTitle: String {
        localized("AI 计划审阅室", "AI Plan Review Room")
    }

    // MARK: - Windows

    @discardableResult
    private func makeChatWindow(destination: ChatDestination) -> ChatWindow {
        let previous = chatWindows.last
        let chatWindow = ChatWindow(
            destination: destination,
            owner: self,
            title: windowTitle,
            dark: theme == "dark"
        )
        chatWindows.append(chatWindow)
        chatWindow.show(cascadingFrom: previous)
        if let serverURL, serverStarted {
            chatWindow.load(base: serverURL, token: accessToken)
        } else {
            chatWindow.showStatus(Self.statusHTML(
                title: localized("正在启动", "Starting"),
                detail: "",
                dark: theme == "dark"
            ))
        }
        return chatWindow
    }

    fileprivate func openChatWindow(destination: ChatDestination) {
        makeChatWindow(destination: destination)
    }

    fileprivate func chatWindowDidClose(_ chatWindow: ChatWindow) {
        chatWindows.removeAll { $0 === chatWindow }
    }

    private var keyChatWindow: ChatWindow? {
        chatWindows.first { $0.window.isKeyWindow } ?? chatWindows.last
    }

    // MARK: - Menus

    private func configureMenus() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: localized("关于 AI Council", "About AI Council"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: localized("退出 AI Council", "Quit AI Council"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: localized("文件", "File"))
        fileItem.submenu = fileMenu
        let newWindow = fileMenu.addItem(withTitle: localized("新建窗口", "New Window"), action: #selector(newChatWindow(_:)), keyEquivalent: "n")
        newWindow.target = self
        let newSession = fileMenu.addItem(withTitle: localized("新建会话", "New Session"), action: #selector(newChatSession(_:)), keyEquivalent: "N")
        newSession.keyEquivalentModifierMask = [.command, .shift]
        newSession.target = self
        fileMenu.addItem(.separator())
        let chooseWorkspace = fileMenu.addItem(withTitle: localized("选择 Workspace…", "Choose Workspace…"), action: #selector(chooseWorkspace(_:)), keyEquivalent: "o")
        chooseWorkspace.target = self
        let chooseProjectsRoot = fileMenu.addItem(withTitle: localized("选择 Projects 文件夹…", "Choose Projects Folder…"), action: #selector(chooseProjectsRoot(_:)), keyEquivalent: "")
        chooseProjectsRoot.target = self
        let addProjects = fileMenu.addItem(withTitle: localized("添加项目文件夹…", "Add Project Folders…"), action: #selector(chooseAdditionalProjects(_:)), keyEquivalent: "")
        addProjects.target = self
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: localized("关闭窗口", "Close Window"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: localized("编辑", "Edit"))
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: localized("撤销", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: localized("重做", "Redo"), action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: localized("剪切", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: localized("复制", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: localized("粘贴", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: localized("全选", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: localized("显示", "View"))
        viewItem.submenu = viewMenu
        let reload = viewMenu.addItem(withTitle: localized("重新载入", "Reload"), action: #selector(reloadPage(_:)), keyEquivalent: "r")
        reload.target = self
        let restart = viewMenu.addItem(withTitle: localized("重新启动本地服务", "Restart Local Service"), action: #selector(restartServer(_:)), keyEquivalent: "R")
        restart.keyEquivalentModifierMask = [.command, .shift]
        restart.target = self

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: localized("窗口", "Window"))
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: localized("最小化", "Minimize"), action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: localized("缩放", "Zoom"), action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: localized("全部置于顶层", "Bring All to Front"), action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Runtime configuration

    private func configureRuntime() -> Bool {
        guard let config = BuildConfig.load() else { return false }
        toolPath = config.toolPath

        let defaults = UserDefaults.standard
        let savedWorkspace = defaults.string(forKey: "workspacePath")
        let candidates = [savedWorkspace, config.workspacePath].compactMap { $0 }
        guard let workspace = candidates
            .map({ URL(fileURLWithPath: $0, isDirectory: true) })
            .first(where: isValidWorkspace)
        else { return false }
        workspaceURL = workspace
        defaults.set(workspace.path, forKey: "workspacePath")

        let nodeCandidates = [
            Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/node").path,
            config.nodePath,
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        guard let nodePath = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            return false
        }
        nodeURL = URL(fileURLWithPath: nodePath)
        return true
    }

    private func restoreProjectsRootAccess() -> Bool {
        let defaults = UserDefaults.standard
        if let data = defaults.data(forKey: "projectsRootBookmark") {
            var stale = false
            if let url = try? URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ), FileManager.default.fileExists(atPath: url.path) {
                if url.startAccessingSecurityScopedResource() { scopedProjectsRootURL = url }
                projectsRootURL = url
                if stale { saveProjectsRootAccess(url) }
                return true
            }
        }
        if let savedPath = defaults.string(forKey: "projectsRootPath"),
           FileManager.default.fileExists(atPath: savedPath) {
            projectsRootURL = URL(fileURLWithPath: savedPath, isDirectory: true)
            return true
        }
        return false
    }

    private func saveProjectsRootAccess(_ url: URL) {
        scopedProjectsRootURL?.stopAccessingSecurityScopedResource()
        scopedProjectsRootURL = url.startAccessingSecurityScopedResource() ? url : nil
        projectsRootURL = url
        let defaults = UserDefaults.standard
        defaults.set(url.path, forKey: "projectsRootPath")
        if let data = try? url.bookmarkData(
            options: [.withSecurityScope],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        ) {
            defaults.set(data, forKey: "projectsRootBookmark")
        }
    }

    private func restoreAdditionalProjectAccess() {
        scopedAdditionalProjectURLs.forEach { $0.stopAccessingSecurityScopedResource() }
        scopedAdditionalProjectURLs = []
        var restored: [URL] = []
        let defaults = UserDefaults.standard
        if let bookmarks = defaults.array(forKey: "additionalProjectBookmarks") as? [Data] {
            for data in bookmarks {
                var stale = false
                guard let url = try? URL(
                    resolvingBookmarkData: data,
                    options: [.withSecurityScope],
                    relativeTo: nil,
                    bookmarkDataIsStale: &stale
                ), FileManager.default.fileExists(atPath: url.path) else { continue }
                if url.startAccessingSecurityScopedResource() { scopedAdditionalProjectURLs.append(url) }
                restored.append(url)
            }
        }
        if let paths = defaults.stringArray(forKey: "additionalProjectPaths") {
            for path in paths where FileManager.default.fileExists(atPath: path) {
                let url = URL(fileURLWithPath: path, isDirectory: true)
                if !restored.contains(where: { $0.path == url.path }) { restored.append(url) }
            }
        }
        additionalProjectURLs = Array(Dictionary(grouping: restored, by: \.path).compactMap(\.value.first).prefix(100))
    }

    private func saveAdditionalProjectAccess(_ selectedURLs: [URL]) {
        var byPath = Dictionary(uniqueKeysWithValues: additionalProjectURLs.map { ($0.path, $0) })
        selectedURLs.forEach { byPath[$0.path] = $0 }
        additionalProjectURLs = Array(byPath.values)
            .filter { FileManager.default.fileExists(atPath: $0.path) }
            .sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
            .prefix(100)
            .map { $0 }

        scopedAdditionalProjectURLs.forEach { $0.stopAccessingSecurityScopedResource() }
        scopedAdditionalProjectURLs = []
        var bookmarks: [Data] = []
        for url in additionalProjectURLs {
            if url.startAccessingSecurityScopedResource() { scopedAdditionalProjectURLs.append(url) }
            if let data = try? url.bookmarkData(
                options: [.withSecurityScope],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            ) {
                bookmarks.append(data)
            }
        }
        let defaults = UserDefaults.standard
        defaults.set(additionalProjectURLs.map(\.path), forKey: "additionalProjectPaths")
        defaults.set(bookmarks, forKey: "additionalProjectBookmarks")
    }

    private func isValidWorkspace(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.appendingPathComponent("scripts/chat-server.mjs").path)
            && FileManager.default.fileExists(atPath: url.appendingPathComponent("public/index.html").path)
    }

    private static func makeToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            return UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }
        return Data(bytes)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - Local service

    private func startServer() {
        guard serverProcess == nil, workspaceURL != nil, projectsRootURL != nil, nodeURL != nil else { return }
        showLoading()
        outputBuffer = ""
        serverStarted = false
        serverURL = nil
        accessToken = Self.makeToken()

        let process = Process()
        let pipe = Pipe()
        let readyFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("ai-council-ready-\(UUID().uuidString).json")
        try? FileManager.default.removeItem(at: readyFile)
        readyFileURL = readyFile
        process.executableURL = nodeURL
        var arguments = [
            workspaceURL.appendingPathComponent("scripts/chat-server.mjs").path,
            "--port", "0",
            "--token", accessToken,
            "--projects-root", projectsRootURL.path,
            "--ready-file", readyFile.path,
        ]
        for projectURL in additionalProjectURLs {
            arguments.append(contentsOf: ["--project-path", projectURL.path])
        }
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = toolPath
        process.environment = environment
        process.standardOutput = pipe
        process.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.consumeServerOutput(text) }
        }
        process.terminationHandler = { [weak self] task in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.serverProcess?.processIdentifier == task.processIdentifier else { return }
                self.serverProcess = nil
                self.serverPipe?.fileHandleForReading.readabilityHandler = nil
                self.serverPipe = nil
                if !self.isTerminating && !self.serverStarted {
                    self.showStartupFailure(self.localized("本地服务未能启动。", "The local service could not start."))
                }
            }
        }

        do {
            try process.run()
            serverProcess = process
            serverPipe = pipe
            pollReadyFile(for: process, attempt: 0)
        } catch {
            showStartupFailure(localized("无法启动 Node 本地服务。", "The local Node service could not be launched."))
        }
    }

    private func consumeServerOutput(_ text: String) {
        guard !serverStarted else { return }
        outputBuffer += text
        if outputBuffer.count > 16_000 { outputBuffer = String(outputBuffer.suffix(16_000)) }

        for line in outputBuffer.split(separator: "\n", omittingEmptySubsequences: true) {
            guard line.hasPrefix("Open: ") else { continue }
            let value = line.dropFirst("Open: ".count).trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URL(string: value), url.host == "127.0.0.1" else { continue }
            loadServer(url)
            break
        }
    }

    private func pollReadyFile(for process: Process, attempt: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self, weak process] in
            guard let self, let process else { return }
            guard self.serverProcess?.processIdentifier == process.processIdentifier,
                  process.isRunning,
                  !self.serverStarted else { return }
            if let readyFileURL = self.readyFileURL,
               let data = try? Data(contentsOf: readyFileURL),
               let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let string = value["url"] as? String,
               let url = URL(string: string),
               url.host == "127.0.0.1" {
                self.loadServer(url)
                return
            }
            if attempt < 449 {
                self.pollReadyFile(for: process, attempt: attempt + 1)
            } else {
                self.showStartupFailure(self.localized("本地服务启动超时。", "The local service timed out while starting."))
            }
        }
    }

    /// The service prints one origin; each window appends its own pin to it.
    private func loadServer(_ url: URL) {
        guard !serverStarted else { return }
        serverStarted = true
        if let readyFileURL { try? FileManager.default.removeItem(at: readyFileURL) }
        readyFileURL = nil
        var base = URLComponents(url: url, resolvingAgainstBaseURL: false)
        base?.query = nil
        serverURL = base?.url ?? url
        guard let serverURL else { return }
        if chatWindows.isEmpty { openChatWindow(destination: ChatDestination()) }
        chatWindows.forEach { $0.load(base: serverURL, token: accessToken) }
    }

    private func stopServer(wait: Bool) {
        serverStarted = false
        serverURL = nil
        serverPipe?.fileHandleForReading.readabilityHandler = nil
        serverPipe = nil
        if let readyFileURL { try? FileManager.default.removeItem(at: readyFileURL) }
        readyFileURL = nil
        guard let process = serverProcess else { return }
        serverProcess = nil
        if process.isRunning {
            process.terminate()
            if wait { process.waitUntilExit() }
        }
    }

    private func showLoading() {
        let html = Self.statusHTML(
            title: localized("正在启动", "Starting"),
            detail: "",
            dark: theme == "dark"
        )
        chatWindows.forEach { $0.showStatus(html) }
    }

    private func showStartupFailure(_ message: String) {
        let html = Self.statusHTML(
            title: localized("启动失败", "Startup failed"),
            detail: message,
            dark: theme == "dark"
        )
        chatWindows.forEach { $0.showStatus(html) }
    }

    private static func statusHTML(title: String, detail: String, dark: Bool) -> String {
        let background = dark ? "#1e1f22" : "#f2f3f5"
        let foreground = dark ? "#f2f3f5" : "#1e1f22"
        let muted = dark ? "#b5bac1" : "#5c6068"
        return """
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:\(dark ? "dark" : "light");font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:\(foreground);background:\(background)}
        body{margin:0;min-height:100vh;display:grid;place-items:center;background:\(background)}
        main{text-align:center}.mark{width:42px;height:42px;margin:auto;border:3px solid #d5dfda;border-top-color:#1e6f57;border-radius:50%;animation:r .8s linear infinite}
        h1{margin:20px 0 0;font:600 20px -apple-system,BlinkMacSystemFont,sans-serif}p{color:\(muted);font-size:12px}@keyframes r{to{transform:rotate(360deg)}}
        </style><main><div class="mark"></div><h1>\(title)</h1><p>\(detail)</p></main>
        """
    }

    // MARK: - Actions

    @objc private func reloadPage(_ sender: Any?) {
        guard serverStarted, let chatWindow = keyChatWindow, chatWindow.hasLoaded else { return }
        chatWindow.webView.reload()
    }

    @objc private func restartServer(_ sender: Any?) {
        stopServer(wait: false)
        chatWindows.forEach { $0.reset() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.startServer() }
    }

    /// A new window starts a new session in whatever project the current window
    /// is on, so two conversations in the same folder never share a transcript.
    @objc private func newChatWindow(_ sender: Any?) {
        let destination = ChatDestination(
            projectID: keyChatWindow?.destination.projectID ?? "",
            sessionID: "",
            fresh: true
        )
        openChatWindow(destination: destination)
    }

    @objc private func newChatSession(_ sender: Any?) {
        keyChatWindow?.evaluate("window.aiCouncil && window.aiCouncil.newSession();")
    }

    @objc private func chooseWorkspace(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.title = localized("选择 AI Council Workspace", "Choose AI Council Workspace")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = workspaceURL
        guard panel.runModal() == .OK, let url = panel.url, isValidWorkspace(url) else { return }
        workspaceURL = url
        UserDefaults.standard.set(url.path, forKey: "workspacePath")
        restartServer(nil)
    }

    @objc private func chooseProjectsRoot(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.title = localized("选择 Projects 文件夹", "Choose Projects Folder")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = projectsRootURL ?? workspaceURL.deletingLastPathComponent()
        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else {
                if self.serverProcess == nil {
                    self.showStartupFailure(self.localized("需要选择 Projects 文件夹。", "A Projects folder is required."))
                }
                return
            }
            self.saveProjectsRootAccess(url)
            self.restoreAdditionalProjectAccess()
            if self.serverProcess == nil { self.startServer() }
            else { self.restartServer(nil) }
        }
        if let window = keyChatWindow?.window {
            panel.beginSheetModal(for: window, completionHandler: handler)
        } else {
            handler(panel.runModal())
        }
    }

    @objc private func chooseAdditionalProjects(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.title = localized("添加项目文件夹", "Add Project Folders")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = localized("添加", "Add")
        panel.directoryURL = projectsRootURL ?? URL(fileURLWithPath: "/", isDirectory: true)
        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self, response == .OK, !panel.urls.isEmpty else { return }
            self.saveAdditionalProjectAccess(panel.urls)
            self.restartServer(nil)
        }
        if let window = keyChatWindow?.window {
            panel.beginSheetModal(for: window, completionHandler: handler)
        } else {
            handler(panel.runModal())
        }
    }

    private func shellQuoted(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private func startAuthentication(for agent: String) {
        let command: String
        let displayName: String
        let verification: String
        switch agent {
        case "claude":
            command = "claude auth login"
            verification = "claude auth status >/dev/null 2>&1"
            displayName = "Claude"
        case "codex":
            command = "codex login"
            verification = "codex login status >/dev/null 2>&1"
            displayName = "Codex"
        case "gemini":
            command = "agy models"
            verification = "true"
            displayName = "Gemini"
        default:
            return
        }

        let scriptURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ai-council-auth-\(agent)-\(UUID().uuidString).command")
        let title = localized("正在恢复 \(displayName) 登录", "Restoring \(displayName) sign-in")
        let done = localized("完成后可关闭此窗口并返回 AI Council。", "When finished, close this window and return to AI Council.")
        let failed = localized("登录未完成，或 CLI 暂时无法读取刚保存的登录状态。请保留此窗口中的错误信息。", "Sign-in did not finish, or the CLI cannot read the saved sign-in state. Keep the error shown in this window.")
        let script = """
        #!/bin/zsh
        export PATH=\(shellQuoted(toolPath))
        clear
        echo \(shellQuoted(title))
        echo
        if \(command) && \(verification); then
          echo
          echo \(shellQuoted(done))
        else
          echo
          echo \(shellQuoted(failed))
          exit 1
        fi
        """

        do {
            try script.write(to: scriptURL, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptURL.path)
            NSWorkspace.shared.open(scriptURL)
            DispatchQueue.global().asyncAfter(deadline: .now() + 600) {
                try? FileManager.default.removeItem(at: scriptURL)
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = localized("无法打开登录窗口", "Unable to open the sign-in window")
            alert.informativeText = localized("请确认 Terminal 可用后重试。", "Make sure Terminal is available, then try again.")
            alert.alertStyle = .warning
            if let window = keyChatWindow?.window {
                alert.beginSheetModal(for: window)
            } else {
                alert.runModal()
            }
        }
    }

    // MARK: - Web bridge

    fileprivate func handleBridge(action: String, body: [String: Any], from chatWindow: ChatWindow) {
        switch action {
        case "addProjects":
            chooseAdditionalProjects(nil)
        case "openWindow":
            let destination = ChatDestination(
                projectID: body["project"] as? String ?? "",
                sessionID: body["session"] as? String ?? "",
                fresh: body["fresh"] as? Bool ?? true
            )
            openChatWindow(destination: destination)
        case "setLanguage":
            guard let value = body["language"] as? String, value == "zh" || value == "en" else { return }
            language = value
            UserDefaults.standard.set(value, forKey: "language")
            configureMenus()
            chatWindows.forEach { $0.window.title = windowTitle }
        case "setTheme":
            guard let value = body["theme"] as? String, value == "light" || value == "dark" else { return }
            theme = value
            UserDefaults.standard.set(value, forKey: "theme")
            let appearance = NSAppearance(named: value == "dark" ? .darkAqua : .aqua)
            chatWindows.forEach { $0.apply(appearance: appearance) }
        case "reauthenticate":
            guard let agent = body["agent"] as? String else { return }
            startAuthentication(for: agent)
        default:
            _ = chatWindow
        }
    }
}

@main
struct AICouncilApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }
}
