/** @jest-environment jsdom */
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  PublicConfigProvider,
  PublicConfigContext,
  usePublicConfig,
  type PublicConfig,
} from './PublicConfig';
import { DemoBanner } from './DemoBanner';
import { AiModeChip } from '../features/ai/components/AiModeChip';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { LandingPage } from '../pages/LandingPage';
import { apiClient } from '../shared/api';
import { useCurrentUser, useLogin, useRegister } from '../features/auth/api/useAuth';

jest.mock('../features/auth/api/useAuth');
const fixture: PublicConfig = {
  environment: 'demo',
  demo: true,
  registrationMode: 'disabled',
  ai: { mode: 'deterministic', modelName: null },
};
beforeEach(() => {
  jest
    .mocked(useCurrentUser)
    .mockReturnValue({ data: null } as ReturnType<typeof useCurrentUser>);
  jest.mocked(useLogin).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useLogin>);
  jest.mocked(useRegister).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useRegister>);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
function renderConfig(config: PublicConfig | undefined, failed = false) {
  return render(
    <PublicConfigContext.Provider
      value={{ config, failed, pending: config === undefined }}
    >
      <MemoryRouter>
        <DemoBanner />
        <AiModeChip />
        <LoginPage />
        <RegisterPage />
        <LandingPage />
      </MemoryRouter>
    </PublicConfigContext.Provider>,
  );
}
it.each(['open', 'invite-only', 'disabled'] as const)(
  'enforces %s on login, all landing links and the registration route',
  (mode) => {
    renderConfig({ ...fixture, registrationMode: mode });
    const links = screen
      .queryAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/register');
    expect(links.length > 0).toBe(mode === 'open');
    expect(screen.queryByLabelText('Display name') !== null).toBe(mode === 'open');
    if (mode !== 'open')
      expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  },
);
it('shows the precise demo warning and fixture label on every demo page', () => {
  renderConfig(fixture);
  expect(
    screen.getByText(
      'Portfolio demo environment. Data may be reset periodically. Do not upload confidential, personal or sensitive information.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('Fixture AI (deterministic)')).toBeTruthy();
  expect(screen.queryByText(/Live model:/)).toBeNull();
});
it('shows live model identity without the demo banner outside demo', () => {
  renderConfig({
    ...fixture,
    demo: false,
    ai: { mode: 'live', modelName: 'test-live-model' },
  });
  expect(screen.getByText('Live model: test-live-model')).toBeTruthy();
  expect(screen.queryByText(/Portfolio demo environment/)).toBeNull();
});
it.each([false, true])(
  'keeps registration closed when configuration is missing (failed=%s)',
  (failed) => {
    renderConfig(undefined, failed);
    expect(screen.getByText('AI mode unavailable')).toBeTruthy();
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(
      screen
        .queryAllByRole('link')
        .some((link) => link.getAttribute('href') === '/register'),
    ).toBe(false);
    if (failed) expect(screen.getByRole('alert')).toBeTruthy();
  },
);
function Facts() {
  const state = usePublicConfig();
  return (
    <output>{state.config?.environment ?? (state.failed ? 'failed' : 'pending')}</output>
  );
}
it('fetches the unauthenticated configuration once and shares it with all consumers', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue(fixture);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PublicConfigProvider>
        <Facts />
        <DemoBanner />
        <AiModeChip />
      </PublicConfigProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('demo');
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith(
    '/api/public/config',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByText('Fixture AI (deterministic)')).toBeTruthy();
  client.clear();
});
it('reports configuration failure after the bounded retry', async () => {
  jest.spyOn(apiClient, 'get').mockRejectedValue(new Error('offline'));
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <PublicConfigProvider>
        <Facts />
        <DemoBanner />
      </PublicConfigProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText('failed')).toBeTruthy());
  expect(screen.getByRole('alert')).toBeTruthy();
  client.clear();
});
it('can label historical outputs using their own provider identity', () => {
  render(<AiModeChip ai={{ mode: 'live', modelName: 'historical-live-model' }} />);
  expect(screen.getByText('Live model: historical-live-model')).toBeTruthy();
});
