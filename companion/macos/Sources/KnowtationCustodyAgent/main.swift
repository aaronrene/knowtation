import Darwin
import Foundation
import KnowtationSecurity
import Security
import XPC

private let allowedAccounts: Set<String> = [
    "knowtation.companion.accessToken",
    "knowtation.companion.refreshToken",
    "knowtation.companion.sessionMeta",
    "knowtation.companion.loopbackToken",
    "knowtation.companion.updateFloor",
]

private struct CustodyRequest: Codable {
    let id: String
    let operation: String
    let account: String?
    let value: String?
}

private struct CustodyResponse: Codable {
    let id: String
    let ok: Bool
    let value: String?
    let error: String?
}

private enum KeychainStore {
    static func query(account: String) throws -> [String: Any] {
        let teamIdentifier = try CallerIdentityValidator.hostTeamIdentifier()
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KnowtationReleaseContract.keychainService,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: "\(teamIdentifier).\(KnowtationReleaseContract.custodyIdentifier)",
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    static func get(account: String) throws -> String? {
        var item: CFTypeRef?
        let query = try query(account: account).merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]) { _, latest in latest }
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        return value
    }

    static func set(account: String, value: String) throws {
        guard !value.isEmpty, value.utf8.count <= 8192 else {
            throw NSError(domain: "KnowtationCustody", code: 1)
        }
        let data = Data(value.utf8)
        let query = try query(account: account)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus))
        }
        let add = query.merging(update) { _, latest in latest }
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus))
        }
    }

    static func delete(account: String) throws {
        let query = try query(account: account)
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}

private final class CapabilitySession {
    let id: UUID
    private let handle: FileHandle
    private let queue = DispatchQueue(label: "store.knowtation.custody.session")
    private let onClose: (UUID) -> Void
    private var buffer = Data()
    private var closed = false

    init(id: UUID, handle: FileHandle, onClose: @escaping (UUID) -> Void) {
        self.id = id
        self.handle = handle
        self.onClose = onClose
    }

    func start() {
        handle.readabilityHandler = { [weak self] readable in
            let data = readable.availableData
            guard let self else { return }
            if data.isEmpty {
                self.queue.async { self.finish() }
                return
            }
            self.queue.async { self.accept(data) }
        }
    }

    private func accept(_ data: Data) {
        buffer.append(data)
        if buffer.count > 65_536 {
            finish()
            return
        }
        while let newline = buffer.firstIndex(of: 0x0a) {
            let frame = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            guard frame.count <= 16_384 else { continue }
            respond(to: Data(frame))
        }
    }

    private func respond(to frame: Data) {
        let request: CustodyRequest
        do {
            request = try JSONDecoder().decode(CustodyRequest.self, from: frame)
        } catch {
            write(CustodyResponse(id: "invalid", ok: false, value: nil, error: "invalid_request"))
            return
        }
        guard request.id.count <= 128 else {
            write(CustodyResponse(id: "invalid", ok: false, value: nil, error: "invalid_request"))
            return
        }
        do {
            switch request.operation {
            case "status":
                write(CustodyResponse(id: request.id, ok: true, value: "available", error: nil))
            case "get":
                let account = try requireAccount(request.account)
                let value = try KeychainStore.get(account: account)
                write(CustodyResponse(id: request.id, ok: true, value: value, error: nil))
            case "set":
                let account = try requireAccount(request.account)
                guard let value = request.value else { throw CustodyError.invalidRequest }
                try KeychainStore.set(account: account, value: value)
                write(CustodyResponse(id: request.id, ok: true, value: nil, error: nil))
            case "delete":
                let account = try requireAccount(request.account)
                try KeychainStore.delete(account: account)
                write(CustodyResponse(id: request.id, ok: true, value: nil, error: nil))
            default:
                throw CustodyError.invalidRequest
            }
        } catch {
            write(CustodyResponse(id: request.id, ok: false, value: nil, error: "custody_operation_failed"))
        }
    }

    private enum CustodyError: Error { case invalidRequest }

    private func requireAccount(_ account: String?) throws -> String {
        guard let account, allowedAccounts.contains(account) else {
            throw CustodyError.invalidRequest
        }
        return account
    }

    private func write(_ response: CustodyResponse) {
        guard var data = try? JSONEncoder().encode(response) else { return }
        data.append(0x0a)
        do { try handle.write(contentsOf: data) } catch {
            finish()
        }
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        handle.readabilityHandler = nil
        try? handle.close()
        onClose(id)
    }
}

private final class CapabilityService {
    private var sessions: [UUID: CapabilitySession] = [:]
    private let lock = NSLock()

    func openCapability(scope: String, identity: CallerIdentity) throws -> Int32 {
        guard let mode = KnowtationRuntimeMode(rawValue: scope),
              mode.requiredCallerIdentifier == identity.identifier else {
            throw CapabilityError.scopeDenied
        }
        var descriptors: [Int32] = [-1, -1]
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0 else {
            throw CapabilityError.socketFailed
        }
        let serverHandle = FileHandle(fileDescriptor: descriptors[0], closeOnDealloc: true)
        let sessionID = UUID()
        let session = CapabilitySession(id: sessionID, handle: serverHandle) { [weak self] id in
            self?.removeSession(id)
        }
        lock.lock()
        sessions[sessionID] = session
        lock.unlock()
        session.start()
        return descriptors[1]
    }

    private func removeSession(_ id: UUID) {
        lock.lock()
        sessions.removeValue(forKey: id)
        lock.unlock()
    }

    enum CapabilityError: Error { case scopeDenied, socketFailed }
}

private let capabilityService = CapabilityService()

private func handleMessage(_ message: xpc_object_t, from peer: xpc_connection_t) {
    guard xpc_get_type(message) == XPC_TYPE_DICTIONARY,
          let reply = xpc_dictionary_create_reply(message) else { return }
    do {
        let identity = try CallerIdentityValidator.validate(message: message)
        guard let scopePointer = xpc_dictionary_get_string(message, CustodyCapability.scopeKey) else {
            throw CapabilityService.CapabilityError.scopeDenied
        }
        let descriptor = try capabilityService.openCapability(
            scope: String(cString: scopePointer),
            identity: identity
        )
        xpc_dictionary_set_fd(reply, CustodyCapability.descriptorKey, descriptor)
        close(descriptor)
    } catch {
        xpc_dictionary_set_string(reply, CustodyCapability.errorKey, "caller_denied")
    }
    xpc_connection_send_message(peer, reply)
}

let listener = xpc_connection_create_mach_service(
    KnowtationReleaseContract.custodyMachService,
    nil,
    UInt64(XPC_CONNECTION_MACH_SERVICE_LISTENER)
)
xpc_connection_set_event_handler(listener) { peer in
    guard xpc_get_type(peer) == XPC_TYPE_CONNECTION else { return }
    let connection = peer
    xpc_connection_set_event_handler(connection) { message in
        handleMessage(message, from: connection)
    }
    xpc_connection_resume(connection)
}
xpc_connection_resume(listener)
dispatchMain()
