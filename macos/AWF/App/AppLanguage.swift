import CoreFoundation
import Foundation

enum AppLanguage: String, CaseIterable, Equatable, Sendable {
    case en
    case ko

    static let defaultLanguage: Self = .en

    var localeIdentifier: String {
        switch self {
        case .en:
            return "en-US"
        case .ko:
            return "ko-KR"
        }
    }
}

enum AppLanguagePreference {
    static let key = "AWFLanguage"

    static func load(
        from defaults: UserDefaults = .standard
    ) -> AppLanguage {
        guard
            let rawValue = defaults.string(forKey: key),
            let language = AppLanguage(rawValue: rawValue)
        else {
            return .defaultLanguage
        }
        return language
    }

    static func save(
        _ language: AppLanguage,
        to defaults: UserDefaults = .standard
    ) {
        defaults.set(language.rawValue, forKey: key)
    }
}

enum AppLocalizationCatalogError: Error, Equatable, Sendable {
    case missingLocalization(AppLanguage)
    case missingCatalog(AppLanguage)
    case invalidCatalog(AppLanguage)
    case keyMismatch(
        missingInEnglish: [String],
        missingInKorean: [String]
    )
}

enum AppLocalization {
    static func localizedBundle(
        for language: AppLanguage,
        in resourceBundle: Bundle = .main
    ) -> Bundle? {
        guard
            let path = resourceBundle.path(
                forResource: language.rawValue,
                ofType: "lproj"
            )
        else {
            return nil
        }
        return Bundle(path: path)
    }

    static func string(
        _ key: String,
        language: AppLanguage,
        table: String? = nil,
        in resourceBundle: Bundle = .main
    ) -> String {
        guard
            let bundle = localizedBundle(
                for: language,
                in: resourceBundle
            )
        else {
            return key
        }
        return bundle.localizedString(
            forKey: key,
            value: key,
            table: table
        )
    }

    static func localizedKeys(
        for language: AppLanguage,
        in resourceBundle: Bundle = .main
    ) throws -> Set<String> {
        guard
            let bundle = localizedBundle(
                for: language,
                in: resourceBundle
            )
        else {
            throw AppLocalizationCatalogError
                .missingLocalization(language)
        }
        guard
            let catalogURL = bundle.url(
                forResource: "Localizable",
                withExtension: "strings"
            ),
            let data = try? Data(
                contentsOf: catalogURL,
                options: [.mappedIfSafe]
            )
        else {
            throw AppLocalizationCatalogError.missingCatalog(language)
        }

        let value: Any
        do {
            value = try PropertyListSerialization.propertyList(
                from: data,
                options: [],
                format: nil
            )
        } catch {
            throw AppLocalizationCatalogError.invalidCatalog(language)
        }
        guard
            let catalog = value as? [String: String],
            !catalog.isEmpty
        else {
            throw AppLocalizationCatalogError.invalidCatalog(language)
        }
        return Set(catalog.keys)
    }

    @discardableResult
    static func requireEnglishKoreanKeyParity(
        in resourceBundle: Bundle = .main
    ) throws -> Set<String> {
        let english = try localizedKeys(
            for: .en,
            in: resourceBundle
        )
        let korean = try localizedKeys(
            for: .ko,
            in: resourceBundle
        )
        return try requireEnglishKoreanKeyParity(
            english: english,
            korean: korean
        )
    }

    @discardableResult
    static func requireEnglishKoreanKeyParity(
        english: Set<String>,
        korean: Set<String>
    ) throws -> Set<String> {
        guard english == korean else {
            throw AppLocalizationCatalogError.keyMismatch(
                missingInEnglish: Array(korean.subtracting(english)).sorted(),
                missingInKorean: Array(english.subtracting(korean)).sorted()
            )
        }
        return english
    }
}

enum AppLanguageBridgeMessageError: Error, Equatable, Sendable {
    case invalidMessage
}

struct AppLanguageBridgeMessage: Equatable, Sendable {
    static let version = 1
    private static let keys: Set<String> = ["v", "language"]

    let language: AppLanguage

    init(body: Any) throws {
        guard
            let object = body as? [String: Any],
            Set(object.keys) == Self.keys,
            Self.integer(object["v"]) == Self.version,
            let rawLanguage = object["language"] as? String,
            let language = AppLanguage(rawValue: rawLanguage)
        else {
            throw AppLanguageBridgeMessageError.invalidMessage
        }
        self.language = language
    }

    var body: [String: Any] {
        [
            "v": Self.version,
            "language": language.rawValue,
        ]
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber else {
            return nil
        }
        guard CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return nil
        }
        let double = number.doubleValue
        guard
            double.isFinite,
            double.rounded(.towardZero) == double,
            double >= Double(Int.min),
            double <= Double(Int.max)
        else {
            return nil
        }
        return Int(double)
    }
}
