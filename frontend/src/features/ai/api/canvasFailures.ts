import { ApiError, type ApiErrorCode } from '../../../shared/api';

export function canvasFailure(code: ApiErrorCode | null | undefined): string {
  switch (code) {
    case 'AI_OUTPUT_INVALID':
      return 'AI zwróciło odpowiedź w nieprawidłowym formacie. Dokument nie został zmieniony. Spróbuj ponownie.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'Osiągnięto limit żądań. Poczekaj na odnowienie limitu i ponów zapisane polecenie. Dokument nie został zmieniony.';
    case 'FORBIDDEN':
    case 'RESOURCE_NOT_FOUND':
    case 'UNAUTHENTICATED':
      return 'Brak dostępu do dokumentu lub wybranych danych. Sprawdź uprawnienia i zaloguj się ponownie. Polecenie pozostaje w historii.';
    case 'AI_UNAVAILABLE':
      return 'AI nie odpowiedziało w wymaganym czasie lub jest chwilowo niedostępne. Dokument nie został zmieniony. Ponowne wysłanie może naliczyć nowy koszt.';
    case 'AI_REFUSED':
      return 'AI odmówiło wykonania polecenia. Doprecyzuj zadanie lub wybierz odpowiednie źródła. Dokument nie został zmieniony.';
    case 'CONFLICT':
      return 'Kontekst dokumentu uległ zmianie. Wybierz aktualny fragment i ponów zapisane polecenie.';
    default:
      return 'Nie udało się ukończyć polecenia. Dokument nie został zmieniony. Polecenie można przywrócić z historii.';
  }
}
export function describeCanvasFailure(error: unknown): string {
  return canvasFailure(
    error instanceof ApiError
      ? error.problem.code === 'UNKNOWN'
        ? null
        : error.problem.code
      : null,
  );
}
/** Bounded polling, independent of provider retry. Terminal/error state stops observation. */
export function canvasPollDelay(
  pending: boolean,
  updates: number,
  failed: boolean,
): number | false {
  return pending && !failed
    ? Math.min(16000, 2000 * 2 ** Math.min(3, Math.floor(Math.max(0, updates - 1) / 3)))
    : false;
}
