import Capacitor
import CryptoKit
import DeviceCheck
import Foundation
import Security

@objc(OysterunAppAttestPlugin)
public class OysterunAppAttestPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OysterunAppAttestPlugin"
    public let jsName = "OysterunAppAttest"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "attest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearIdentity", returnType: CAPPluginReturnPromise)
    ]

    private let appAttestKeyAccount = "oysterun-app-attest-key-id"

    @objc func attest(_ call: CAPPluginCall) {
        guard DCAppAttestService.shared.isSupported else {
            call.reject("Apple App Attest is not supported on this device.")
            return
        }
        guard let challenge = call.getString("challenge"), !challenge.isEmpty else {
            call.reject("challenge is required.")
            return
        }

        let challengeData = Data(challenge.utf8)
        let clientDataHash = Data(SHA256.hash(data: challengeData))

        getOrCreateAppAttestKeyId { result in
            switch result {
            case .failure(let error):
                call.reject("Unable to create App Attest key: \(error.localizedDescription)")
            case .success(let keyId):
                DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash) { attestationObject, error in
                    if let error = error {
                        call.reject("App Attest attestation failed: \(error.localizedDescription)")
                        return
                    }
                    guard let attestationObject = attestationObject else {
                        call.reject("App Attest returned an empty attestation object.")
                        return
                    }
                    call.resolve([
                        "app_attest_key_id": keyId,
                        "attestation_object": attestationObject.base64EncodedString()
                    ])
                }
            }
        }
    }

    @objc func loadIdentity(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required.")
            return
        }
        call.resolve([
            "identity": keychainGet(account: identityAccount(key))
        ])
    }

    @objc func saveIdentity(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required.")
            return
        }
        guard let identity = call.getString("identity"), !identity.isEmpty else {
            call.reject("identity is required.")
            return
        }
        do {
            try keychainSet(identity, account: identityAccount(key))
            call.resolve(["saved": true])
        } catch {
            call.reject("Unable to save installation identity: \(error.localizedDescription)")
        }
    }

    @objc func clearIdentity(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required.")
            return
        }
        keychainDelete(account: identityAccount(key))
        call.resolve(["cleared": true])
    }

    private func getOrCreateAppAttestKeyId(
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        if let existing = keychainGet(account: appAttestKeyAccount), !existing.isEmpty {
            completion(.success(existing))
            return
        }
        DCAppAttestService.shared.generateKey { keyId, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let keyId = keyId, !keyId.isEmpty else {
                completion(.failure(AppAttestPluginError.emptyKeyId))
                return
            }
            do {
                try self.keychainSet(keyId, account: self.appAttestKeyAccount)
                completion(.success(keyId))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func identityAccount(_ key: String) -> String {
        "oysterun-cloud-installation-identity:\(key)"
    }

    private func keychainGet(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService(),
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func keychainSet(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService(),
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess {
            return
        }
        if status != errSecItemNotFound {
            throw AppAttestPluginError.keychainStatus(status)
        }
        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw AppAttestPluginError.keychainStatus(addStatus)
        }
    }

    private func keychainDelete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService(),
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func keychainService() -> String {
        Bundle.main.bundleIdentifier ?? "com.example.oysteruncore"
    }
}

private enum AppAttestPluginError: LocalizedError {
    case emptyKeyId
    case keychainStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .emptyKeyId:
            return "App Attest returned an empty key id."
        case .keychainStatus(let status):
            return "Keychain returned status \(status)."
        }
    }
}

@objc(OysterunDashboardAuthPlugin)
public class OysterunDashboardAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OysterunDashboardAuthPlugin"
    public let jsName = "OysterunDashboardAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    @objc func load(_ call: CAPPluginCall) {
        guard let origin = normalizedOrigin(call.getString("origin")) else {
            call.reject("origin is required.")
            return
        }
        call.resolve([
            "token": keychainGet(account: dashboardTokenAccount(origin)) ?? ""
        ])
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let origin = normalizedOrigin(call.getString("origin")) else {
            call.reject("origin is required.")
            return
        }
        guard let token = call.getString("token"), !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("token is required.")
            return
        }
        do {
            try keychainSet(token, account: dashboardTokenAccount(origin))
            call.resolve(["saved": true])
        } catch {
            call.reject("Unable to save dashboard token: \(error.localizedDescription)")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard let origin = normalizedOrigin(call.getString("origin")) else {
            call.reject("origin is required.")
            return
        }
        keychainDelete(account: dashboardTokenAccount(origin))
        call.resolve(["cleared": true])
    }

    private func normalizedOrigin(_ rawValue: String?) -> String? {
        guard let raw = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host,
              !host.isEmpty else {
            return nil
        }
        var origin = "\(scheme)://\(host)"
        if let port = components.port {
            origin += ":\(port)"
        }
        return origin
    }

    private func dashboardTokenAccount(_ origin: String) -> String {
        "oysterun-dashboard-auth:\(origin)"
    }

    private func keychainGet(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService(),
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func keychainSet(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService(),
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess {
            return
        }
        if status != errSecItemNotFound {
            throw DashboardAuthPluginError.keychainStatus(status)
        }
        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw DashboardAuthPluginError.keychainStatus(addStatus)
        }
    }

    private func keychainDelete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService(),
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func keychainService() -> String {
        Bundle.main.bundleIdentifier ?? "com.example.oysteruncore"
    }
}

private enum DashboardAuthPluginError: LocalizedError {
    case keychainStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .keychainStatus(let status):
            return "Keychain returned status \(status)."
        }
    }
}
