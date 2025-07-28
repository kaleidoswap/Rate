import Foundation
import ExpoModulesCore

public class RGBNodeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("RGBNode")
        
        Function("startNode") { (options: [String: Any]) -> Promise in
            Promise { promise in
                do {
                    // Extract binary if needed
                    try self.extractBinaryIfNeeded()
                    
                    // Start the node process
                    try self.startNodeProcess(options: options)
                    
                    promise.resolve([
                        "success": true,
                        "daemon_port": options["daemon_listening_port"] ?? 3000,
                        "ldk_peer_port": options["ldk_peer_listening_port"] ?? 9735
                    ])
                } catch {
                    promise.reject("ERR_NODE_START", "Failed to start RGB Lightning Node: \(error.localizedDescription)")
                }
            }
        }
        
        Function("stopNode") { () -> Promise in
            Promise { promise in
                do {
                    try self.stopNodeProcess()
                    promise.resolve(["success": true])
                } catch {
                    promise.reject("ERR_NODE_STOP", "Failed to stop RGB Lightning Node: \(error.localizedDescription)")
                }
            }
        }
        
        Function("isNodeRunning") { () -> Promise in
            Promise { promise in
                let isRunning = self.checkNodeProcess()
                promise.resolve(["isRunning": isRunning])
            }
        }
    }
    
    private var nodeProcess: Process?
    private let binaryName = "rgb-lightning-node"
    
    private func extractBinaryIfNeeded() throws {
        let fileManager = FileManager.default
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let binaryPath = documentsPath.appendingPathComponent(binaryName)
        
        // Check if binary already exists
        if fileManager.fileExists(atPath: binaryPath.path) {
            return
        }
        
        // Get binary from bundle
        guard let bundleBinaryPath = Bundle.main.path(forResource: binaryName, ofType: nil) else {
            throw NSError(domain: "com.rate.rgbwallet", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "RGB Lightning Node binary not found in bundle"
            ])
        }
        
        // Copy binary to documents directory
        try fileManager.copyItem(atPath: bundleBinaryPath, toPath: binaryPath.path)
        
        // Set executable permissions
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binaryPath.path)
    }
    
    private func startNodeProcess(options: [String: Any]) throws {
        let fileManager = FileManager.default
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let binaryPath = documentsPath.appendingPathComponent(binaryName)
        let dataDir = documentsPath.appendingPathComponent("rgb-data")
        
        // Create data directory if it doesn't exist
        try fileManager.createDirectory(at: dataDir, withIntermediateDirectories: true)
        
        // Create and configure process
        let process = Process()
        process.executableURL = binaryPath
        
        // Configure arguments based on options
        var arguments: [String] = []
        arguments.append(dataDir.path)
        
        if let daemonPort = options["daemon_listening_port"] as? Int {
            arguments.append("--daemon-listening-port")
            arguments.append("\(daemonPort)")
        }
        
        if let ldkPort = options["ldk_peer_listening_port"] as? Int {
            arguments.append("--ldk-peer-listening-port")
            arguments.append("\(ldkPort)")
        }
        
        if let network = options["network"] as? String {
            arguments.append("--network")
            arguments.append(network)
        }
        
        process.arguments = arguments
        
        // Setup pipes for output
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        
        // Start process
        try process.run()
        self.nodeProcess = process
        
        // Monitor process in background
        DispatchQueue.global(qos: .background).async {
            process.waitUntilExit()
            
            // Handle process termination
            if process.terminationStatus != 0 {
                let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let errorOutput = String(data: errorData, encoding: .utf8)
                print("RGB Lightning Node process terminated with error: \(errorOutput ?? "Unknown error")")
            }
        }
    }
    
    private func stopNodeProcess() throws {
        guard let process = self.nodeProcess else { return }
        
        process.terminate()
        self.nodeProcess = nil
    }
    
    private func checkNodeProcess() -> Bool {
        guard let process = self.nodeProcess else { return false }
        return process.isRunning
    }
} 