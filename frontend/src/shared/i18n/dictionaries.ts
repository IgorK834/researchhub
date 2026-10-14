import generatedEn from './en.generated.json';
import generatedPl from './pl.generated.json';
export interface PluralMessage {
  readonly one: string;
  readonly few: string;
  readonly many: string;
  readonly other: string;
}
export const en = {
  ...generatedEn,
  'language.label': 'Interface language',
  'language.en': 'English',
  'language.pl': 'Polski',
  'common.cancel': 'Cancel',
  'problem.validation':
    'Check the formula, parameters (symbol;value;unit) and plot range. Use a decimal point in numeric inputs.',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.retry': 'Try again',
  'common.fallback': 'This message is unavailable. Please try again.',
  'common.validationField': 'Check the value in this field.',
  'errors.VALIDATION_FAILED': 'Check the entered values.',
  'errors.MALFORMED_REQUEST': 'The request could not be read.',
  'errors.UNAUTHENTICATED': 'Log in to continue.',
  'errors.FORBIDDEN': 'You do not have permission for this action.',
  'errors.RESOURCE_NOT_FOUND': 'This item is unavailable or you do not have access.',
  'errors.CONFLICT':
    'The item changed or no longer accepts this action. Reload and try again.',
  'errors.DOCUMENT_LIMIT_REACHED':
    'The workspace document limit has been reached. Archive an unused document before creating another.',
  'errors.COLLABORATION_STATE_REPLACED':
    'The shared document state changed. Reload before editing.',
  'errors.PAYLOAD_TOO_LARGE': 'The file or content exceeds the allowed size.',
  'errors.UNSUPPORTED_FILE_TYPE': 'This file type is not supported.',
  'errors.UNSUPPORTED_MEDIA_TYPE': 'This content format is not supported.',
  'errors.AI_UNAVAILABLE':
    'The AI service is unavailable or its request limit has been reached. Try again later or ask the administrator to check the provider limits.',
  'errors.AI_PROVIDER_ERROR': 'The AI provider could not complete this request.',
  'errors.AI_OUTPUT_INVALID':
    'The AI response could not be validated. Please try again or rephrase your request.',
  'errors.AI_REFUSED': 'The model declined this request.',
  'errors.AI_CONTEXT_TOO_LARGE': 'The selected context is too large.',
  'errors.EXTERNAL_SEARCH_UNAVAILABLE': 'External search is unavailable.',
  'errors.EXTERNAL_SEARCH_FAILED': 'External search failed.',
  'errors.METADATA_LOOKUP_UNAVAILABLE': 'Metadata lookup is unavailable.',
  'errors.METADATA_LOOKUP_FAILED': 'Metadata lookup failed.',
  'errors.RATE_LIMIT_EXCEEDED':
    'The request limit has been reached. Wait before trying again.',
  'errors.retryDelay': 'Try again in {seconds} seconds.',
  'errors.transport': 'Could not connect. Check your connection and try again.',
  'errors.INTERNAL_ERROR': 'An unexpected error occurred',
  'documents.count': {
    one: '{count} document',
    few: '{count} documents',
    many: '{count} documents',
    other: '{count} documents',
  },
  'counts.sources': {
    one: '{count} source',
    few: '{count} sources',
    many: '{count} sources',
    other: '{count} sources',
  },
  'counts.members': {
    one: '{count} member',
    few: '{count} members',
    many: '{count} members',
    other: '{count} members',
  },
  'counts.results': {
    one: '{count} result',
    few: '{count} results',
    many: '{count} results',
    other: '{count} results',
  },
  'counts.files': {
    one: '{count} file',
    few: '{count} files',
    many: '{count} files',
    other: '{count} files',
  },
  'counts.sheets': {
    one: '{count} sheet',
    few: '{count} sheets',
    many: '{count} sheets',
    other: '{count} sheets',
  },
  'counts.grounded': {
    one: 'Grounded in {count} source',
    few: 'Grounded in {count} sources',
    many: 'Grounded in {count} sources',
    other: 'Grounded in {count} sources',
  },
  'counts.readyGrounded': {
    one: 'Grounded in {count} ready source',
    few: 'Grounded in {count} ready sources',
    many: 'Grounded in {count} ready sources',
    other: 'Grounded in {count} ready sources',
  },
  'search.openHint': 'open',
  'editor.content': 'Document text',
  'editor.improve': 'Improve writing',
  'editor.shorten': 'Shorten',
  'editor.expand': 'Expand',
  'editor.clarify': 'Clarify',
  'editor.grammar': 'Fix grammar',
  'editor.explain': 'Explain',
  'source.supportedTypes': 'Supported types: {types}.',
  'source.unsupportedExtension': 'Files of type .{extension} are not supported. ',
  'source.mediaMismatch':
    'The file is named .{extension} but was sent as {media}, which is not a {type} media type. {supported}',
  'source.tooLarge': 'The file is larger than the {limit} allowed for one source',
  'source.bytes': '{count} bytes',
  'editor.mathError':
    'Invalid formula. Use canonical decimal numbers, supported symbols and operators, and matching parentheses.',
  'editor.cutError': 'Cut was unavailable. The text is retained; use Ctrl/Cmd+X.',
  'editor.copyError': 'Copy was unavailable. Use Ctrl/Cmd+C.',
  'editor.contextChanged':
    'The selected content changed. Close this window and select it again.',
  'bibliography.chooseFile': 'Choose a bibliography file first.',
  'bibliography.oversized': 'Bibliography files must be at most 2 MiB.',
  'auth.copyError': 'Could not copy. Select and copy the link above.',
  'citation.apa': 'APA 7th edition',
  'workspace.stepSources': 'PDFs, notes and data',
  'workspace.stepDocuments': 'Documents with citations',
  'workspace.stepQuestions': 'Ask AI, see where it came from',
  'documents.create.heading': 'New document',
  'documents.create.description':
    'Start blank or choose a reviewed structure. Templates contain guidance, not generated claims.',
  'documents.create.title': 'Document title',
  'documents.create.submit': 'Create document',
  'documents.create.busy': 'Creating…',
  'templates.choose': 'Starting structure',
  'templates.blank': 'Blank document',
  'templates.locale': 'Template language',
  'templates.use': 'Use a bundled template',
  'templates.select': 'Template',
  'templates.loading': 'Loading templates…',
  'templates.error': 'Could not load templates.',
  'templates.preview': 'Template preview',
  'templates.guidance':
    'Replace TODO prompts with your own verified content. No results, publication metadata or citations are generated.',
  'templates.required': 'Required prompts',
  'templates.version': 'Version {version}',
  'templates.origin': 'Created from a bundled template',
  'export.language': 'Export language',
  'export.languageHint':
    'Changes report labels and citation locale, not your document or scientific values.',
  'ai.answerLanguage': 'Answer language',
  'ai.answerLanguageHint':
    'Separate from the interface language. Citations and scientific values stay original.',
  'numbers.canonicalHint':
    'Use a decimal point in scientific inputs, regardless of interface language.',
} as const;
export type MessageKey = keyof typeof en;
export type Message = string | PluralMessage;
export const pl = {
  ...generatedPl,
  'language.label': 'Język interfejsu',
  'language.en': 'English',
  'language.pl': 'Polski',
  'common.cancel': 'Anuluj',
  'problem.validation':
    'Sprawdź formułę, parametry (symbol;wartość;jednostka) i zakres wykresu. Liczby wpisuj z kropką dziesiętną.',
  'common.close': 'Zamknij',
  'common.save': 'Zapisz',
  'common.retry': 'Spróbuj ponownie',
  'common.fallback': 'Ten komunikat jest niedostępny. Spróbuj ponownie.',
  'common.validationField': 'Sprawdź wartość tego pola.',
  'errors.VALIDATION_FAILED': 'Sprawdź wprowadzone wartości.',
  'errors.MALFORMED_REQUEST': 'Nie można odczytać żądania.',
  'errors.UNAUTHENTICATED': 'Zaloguj się, aby kontynuować.',
  'errors.FORBIDDEN': 'Nie masz uprawnień do tej czynności.',
  'errors.RESOURCE_NOT_FOUND':
    'Ten element jest niedostępny lub nie masz do niego dostępu.',
  'errors.CONFLICT':
    'Element zmienił się lub nie obsługuje już tej czynności. Odśwież widok i spróbuj ponownie.',
  'errors.DOCUMENT_LIMIT_REACHED':
    'Osiągnięto limit dokumentów obszaru roboczego. Zarchiwizuj nieużywany dokument przed utworzeniem kolejnego.',
  'errors.COLLABORATION_STATE_REPLACED':
    'Stan współdzielonego dokumentu zmienił się. Odśwież widok przed edycją.',
  'errors.PAYLOAD_TOO_LARGE': 'Plik lub treść przekracza dozwolony rozmiar.',
  'errors.UNSUPPORTED_FILE_TYPE': 'Ten typ pliku nie jest obsługiwany.',
  'errors.UNSUPPORTED_MEDIA_TYPE': 'Ten format treści nie jest obsługiwany.',
  'errors.AI_UNAVAILABLE':
    'Usługa AI jest niedostępna lub osiągnęła limit żądań. Spróbuj później albo poproś administratora o sprawdzenie limitów dostawcy.',
  'errors.AI_PROVIDER_ERROR': 'Dostawca AI nie mógł wykonać tego żądania.',
  'errors.AI_OUTPUT_INVALID':
    'Nie można zweryfikować odpowiedzi AI. Spróbuj ponownie lub przeformułuj prośbę.',
  'errors.AI_REFUSED': 'Model odmówił wykonania żądania.',
  'errors.AI_CONTEXT_TOO_LARGE': 'Wybrany kontekst jest zbyt duży.',
  'errors.EXTERNAL_SEARCH_UNAVAILABLE': 'Wyszukiwanie zewnętrzne jest niedostępne.',
  'errors.EXTERNAL_SEARCH_FAILED': 'Wyszukiwanie zewnętrzne nie powiodło się.',
  'errors.METADATA_LOOKUP_UNAVAILABLE': 'Wyszukiwanie metadanych jest niedostępne.',
  'errors.METADATA_LOOKUP_FAILED': 'Nie udało się wyszukać metadanych.',
  'errors.RATE_LIMIT_EXCEEDED': 'Osiągnięto limit żądań. Poczekaj przed kolejną próbą.',
  'errors.retryDelay': 'Spróbuj ponownie za {seconds} s.',
  'errors.transport':
    'Nie można nawiązać połączenia. Sprawdź połączenie i spróbuj ponownie.',
  'errors.INTERNAL_ERROR': 'Wystąpił nieoczekiwany błąd',
  'documents.count': {
    one: '{count} dokument',
    few: '{count} dokumenty',
    many: '{count} dokumentów',
    other: '{count} dokumentu',
  },
  'counts.sources': {
    one: '{count} źródło',
    few: '{count} źródła',
    many: '{count} źródeł',
    other: '{count} źródła',
  },
  'counts.members': {
    one: '{count} członek',
    few: '{count} członkowie',
    many: '{count} członków',
    other: '{count} członka',
  },
  'counts.results': {
    one: '{count} wynik',
    few: '{count} wyniki',
    many: '{count} wyników',
    other: '{count} wyniku',
  },
  'counts.files': {
    one: '{count} plik',
    few: '{count} pliki',
    many: '{count} plików',
    other: '{count} pliku',
  },
  'counts.sheets': {
    one: '{count} arkusz',
    few: '{count} arkusze',
    many: '{count} arkuszy',
    other: '{count} arkusza',
  },
  'counts.grounded': {
    one: 'Oparte na {count} źródle',
    few: 'Oparte na {count} źródłach',
    many: 'Oparte na {count} źródłach',
    other: 'Oparte na {count} źródła',
  },
  'counts.readyGrounded': {
    one: 'Oparte na {count} gotowym źródle',
    few: 'Oparte na {count} gotowych źródłach',
    many: 'Oparte na {count} gotowych źródłach',
    other: 'Oparte na {count} gotowego źródła',
  },
  'search.openHint': 'otwórz',
  'editor.content': 'Tekst dokumentu',
  'editor.improve': 'Popraw styl',
  'editor.shorten': 'Skróć',
  'editor.expand': 'Rozwiń',
  'editor.clarify': 'Doprecyzuj',
  'editor.grammar': 'Popraw gramatykę',
  'editor.explain': 'Wyjaśnij',
  'source.supportedTypes': 'Obsługiwane typy: {types}.',
  'source.unsupportedExtension': 'Pliki typu .{extension} nie są obsługiwane. ',
  'source.mediaMismatch':
    'Plik ma rozszerzenie .{extension}, ale przesłano go jako {media}, co nie odpowiada typowi {type}. {supported}',
  'source.tooLarge': 'Plik przekracza limit {limit} dla jednego źródła',
  'source.bytes': '{count} bajtów',
  'editor.mathError':
    'Nieprawidłowa formuła. Użyj kanonicznych liczb dziesiętnych, obsługiwanych symboli i operatorów oraz zgodnych nawiasów.',
  'editor.cutError': 'Wycinanie niedostępne. Tekst zachowano; użyj Ctrl/Cmd+X.',
  'editor.copyError': 'Kopiowanie niedostępne. Użyj Ctrl/Cmd+C.',
  'editor.contextChanged':
    'Wybrana treść się zmieniła. Zamknij okno i zaznacz ją ponownie.',
  'bibliography.chooseFile': 'Najpierw wybierz plik bibliografii.',
  'bibliography.oversized': 'Pliki bibliografii mogą mieć maksymalnie 2 MiB.',
  'auth.copyError': 'Nie udało się skopiować. Zaznacz i skopiuj link powyżej.',
  'citation.apa': 'APA — wydanie 7.',
  'workspace.stepSources': 'PDF-y, notatki i dane',
  'workspace.stepDocuments': 'Dokumenty z cytowaniami',
  'workspace.stepQuestions': 'Zapytaj AI i sprawdź pochodzenie odpowiedzi',
  'documents.create.heading': 'Nowy dokument',
  'documents.create.description':
    'Zacznij od pustego dokumentu lub gotowej struktury. Szablony zawierają wskazówki, a nie wygenerowane twierdzenia.',
  'documents.create.title': 'Tytuł dokumentu',
  'documents.create.submit': 'Utwórz dokument',
  'documents.create.busy': 'Tworzenie…',
  'templates.choose': 'Struktura początkowa',
  'templates.blank': 'Pusty dokument',
  'templates.locale': 'Język szablonu',
  'templates.use': 'Użyj wbudowanego szablonu',
  'templates.select': 'Szablon',
  'templates.loading': 'Ładowanie szablonów…',
  'templates.error': 'Nie udało się załadować szablonów.',
  'templates.preview': 'Podgląd szablonu',
  'templates.guidance':
    'Zastąp pola TODO własną zweryfikowaną treścią. Szablon nie generuje wyników, metadanych publikacji ani cytowań.',
  'templates.required': 'Wymagane wskazówki',
  'templates.version': 'Wersja {version}',
  'templates.origin': 'Dokument utworzono z wbudowanego szablonu',
  'export.language': 'Język eksportu',
  'export.languageHint':
    'Zmienia etykiety raportu i język stylu cytowań, nie treść dokumentu ani wartości naukowe.',
  'ai.answerLanguage': 'Język odpowiedzi',
  'ai.answerLanguageHint':
    'Niezależny od języka interfejsu. Cytowania i wartości naukowe pozostają w oryginale.',
  'numbers.canonicalHint':
    'W danych naukowych używaj kropki dziesiętnej niezależnie od języka interfejsu.',
} satisfies Record<MessageKey, Message>;
