import Foundation
import XPC

public enum CustodyCapability {
    public static let scopeKey = "scope"
    public static let descriptorKey = "capability_fd"
    public static let errorKey = "error"

    /// Requests a capability over a launchd Mach service. The service validates
    /// the sender from the XPC message audit token before attaching a descriptor.
    public static func request(mode: KnowtationRuntimeMode) throws -> FileHandle {
        let connection = xpc_connection_create_mach_service(
            KnowtationReleaseContract.custodyMachService,
            nil,
            0
        )
        xpc_connection_set_event_handler(connection) { _ in }
        xpc_connection_resume(connection)
        defer { xpc_connection_cancel(connection) }

        let message = xpc_dictionary_create(nil, nil, 0)
        xpc_dictionary_set_string(message, scopeKey, mode.rawValue)
        let reply = xpc_connection_send_message_with_reply_sync(connection, message)
        guard xpc_get_type(reply) == XPC_TYPE_DICTIONARY else {
            throw RuntimeLaunchError.capabilityUnavailable("invalid service reply")
        }
        if let errorPointer = xpc_dictionary_get_string(reply, errorKey) {
            throw RuntimeLaunchError.capabilityUnavailable(String(cString: errorPointer))
        }
        let descriptor = xpc_dictionary_dup_fd(reply, descriptorKey)
        guard descriptor >= 0 else {
            throw RuntimeLaunchError.capabilityUnavailable("descriptor unavailable")
        }
        return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    }
}
