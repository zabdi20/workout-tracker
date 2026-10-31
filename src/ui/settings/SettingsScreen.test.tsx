import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db, resetDbForTests } from '../../db/db';
import { getSettings, updateSettings } from '../../db/settings';
import { DAY, seedWorkout, T } from '../../testFixtures';
import { STORAGE_FULL_MESSAGE } from '../useWriteError';
import { SettingsScreen } from './SettingsScreen';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
  vi.restoreAllMocks();
});

const REST_LABEL = 'Default rest between sets (seconds)';
const REST_PROBLEM = /^Rest must be a whole number of seconds, at least 1\.$/;

function renderScreen() {
  return render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );
}

const unit = async () => (await getSettings()).unitPreference;
const defaultRest = async () => (await getSettings()).defaultRestSeconds;

it('saves the unit as soon as it changes', async () => {
  const user = userEvent.setup();
  renderScreen();
  expect(await screen.findByRole('radio', { name: 'lb' })).toBeChecked();

  await user.click(screen.getByRole('radio', { name: 'kg' }));

  await expect.poll(unit).toBe('kg');
  // Re-queried: the radio follows the stored setting once the live query lands.
  await waitFor(() => expect(screen.getByRole('radio', { name: 'kg' })).toBeChecked());
});

it('saves the default rest when the field is left', async () => {
  const user = userEvent.setup();
  renderScreen();
  const field = await screen.findByLabelText(REST_LABEL);
  expect(field).toHaveValue(90);

  await user.clear(field);
  await user.type(field, '120');
  await user.tab();

  await expect.poll(defaultRest).toBe(120);
  await waitFor(() => expect(screen.getByLabelText(REST_LABEL)).toHaveValue(120));
});

it('saves the default rest when the form is submitted', async () => {
  const user = userEvent.setup();
  renderScreen();
  const field = await screen.findByLabelText(REST_LABEL);

  await user.clear(field);
  await user.type(field, '75');
  // The field keeps focus: this is Enter, not a blur. user-event does not
  // submit a form on Enter from a number input, so the submit is fired.
  fireEvent.submit((field as HTMLInputElement).form!);

  await expect.poll(defaultRest).toBe(75);
});

it.each([
  ['0', 0],
  ['1.5', 1.5],
  ['', null],
])(
  "refuses a rest that isn't a whole number of seconds, keeping what was typed (%j)",
  async (typed, shown) => {
    const user = userEvent.setup();
    const put = vi.spyOn(db.settings, 'put');
    renderScreen();
    const field = await screen.findByLabelText(REST_LABEL);

    await user.clear(field);
    if (typed) await user.type(field, typed);
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(REST_PROBLEM);
    expect(await defaultRest()).toBe(90);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByLabelText(REST_LABEL)).toHaveValue(shown);
  },
);

// All digits, so the old check passed them. 309 of them would be Infinity,
// which JSON writes as null, but jsdom (like WebKit) empties a number input
// whose value overflows, so these are the largest values that survive: 20
// nines are far past what a number holds exactly, and the second is the
// first integer past the largest that it does.
it.each([
  ['20 digits', '9'.repeat(20)],
  ['one past the largest safe integer', String(Number.MAX_SAFE_INTEGER + 1)],
])(
  'refuses a rest too large to store, keeping what was typed (%s)',
  async (_label, typed) => {
    const user = userEvent.setup();
    const put = vi.spyOn(db.settings, 'put');
    renderScreen();
    const field = await screen.findByLabelText(REST_LABEL);

    await user.clear(field);
    await user.type(field, typed);
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(REST_PROBLEM);
    expect(await defaultRest()).toBe(90);
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByLabelText(REST_LABEL)).toHaveValue(Number(typed));
  },
);

it('takes the refusal back once a valid rest is saved', async () => {
  const user = userEvent.setup();
  renderScreen();
  const field = await screen.findByLabelText(REST_LABEL);
  await user.clear(field);
  await user.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent(REST_PROBLEM);

  await user.type(screen.getByLabelText(REST_LABEL), '45');
  await user.tab();

  await expect.poll(defaultRest).toBe(45);
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('keeps the typed rest when the write fails', async () => {
  const user = userEvent.setup();
  vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('disk on fire'));
  renderScreen();
  const field = await screen.findByLabelText(REST_LABEL);

  await user.clear(field);
  await user.type(field, '120');
  await user.tab();

  expect(await screen.findByRole('alert')).toHaveTextContent(/^disk on fire$/);
  expect(screen.getByLabelText(REST_LABEL)).toHaveValue(120);
  expect(await defaultRest()).toBe(90);
});

it('offers a backup when storage is full, keeping the typed rest', async () => {
  const user = userEvent.setup();
  vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  renderScreen();
  const field = await screen.findByLabelText(REST_LABEL);

  await user.clear(field);
  await user.type(field, '120');
  await user.tab();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
  expect(screen.getByLabelText(REST_LABEL)).toHaveValue(120);
});

it('turns the rest sound off', async () => {
  const user = userEvent.setup();
  renderScreen();
  expect(await screen.findByRole('checkbox', { name: 'Sound when rest ends' })).toBeChecked();

  await user.click(screen.getByRole('checkbox', { name: 'Sound when rest ends' }));

  await expect.poll(async () => (await getSettings()).restAlertSound).toBe(false);
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Sound when rest ends' })).not.toBeChecked(),
  );
});

it('says when the last backup was', async () => {
  renderScreen();
  expect(await screen.findByText('Last backup: Never')).toBeInTheDocument();

  const at = Date.now() - 3 * DAY;
  await updateSettings({ lastBackupAt: at });

  expect(
    await screen.findByText(`Last backup: ${new Date(at).toLocaleDateString()} · 3 days ago`),
  ).toBeInTheDocument();
  expect(screen.queryByText('Last backup: Never')).not.toBeInTheDocument();
});

function stubStorage(persisted: () => Promise<boolean>) {
  Object.defineProperty(navigator, 'storage', { value: { persisted }, configurable: true });
}

describe('whether iOS has protected the storage', () => {
  it.each([
    { when: 'it is protected', persisted: async () => true, answer: 'Yes' },
    { when: 'it is not protected', persisted: async () => false, answer: 'No' },
    {
      when: 'the browser refuses to say',
      persisted: async (): Promise<boolean> => { throw new Error('denied'); },
      answer: 'Unknown',
    },
  ])('says $answer when $when', async ({ persisted, answer }) => {
    const asked = vi.fn(persisted);
    stubStorage(asked);
    renderScreen();

    expect(await screen.findByText(`Protected from iOS clean-up: ${answer}`)).toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('says Unknown when the browser has no storage manager', async () => {
    renderScreen();

    expect(await screen.findByText('Protected from iOS clean-up: Unknown')).toBeInTheDocument();
  });

  it('explains why a backup matters', async () => {
    renderScreen();

    expect(
      await screen.findByText(
        "iOS may clear this app's data when the phone runs low on space. Your backups are the safety net.",
      ),
    ).toBeInTheDocument();
  });
});

it('offers Back up now', async () => {
  renderScreen();

  expect(await screen.findByRole('button', { name: 'Back up now' })).toBeInTheDocument();
});

it('offers to restore a backup from a file', async () => {
  renderScreen();

  expect(await screen.findByLabelText('Restore from backup…')).toBeInTheDocument();
});

it('turns restoring off while a workout is in progress', async () => {
  // Rejects: a restore control that is never told about the workout.
  await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  renderScreen();

  expect(await screen.findByRole('button', { name: 'Restore from backup…' })).toBeDisabled();
  expect(screen.queryByLabelText('Restore from backup…')).not.toBeInTheDocument();
});

it('turns restoring off when a workout starts, and on again when it ends', async () => {
  // Rejects: a control told once, at first render, and never again.
  renderScreen();
  expect(await screen.findByLabelText('Restore from backup…')).toBeInTheDocument();

  const workout = await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  expect(await screen.findByRole('button', { name: 'Restore from backup…' })).toBeDisabled();

  await db.sessions.update(workout.id, { status: 'completed', endedAt: T + 1000 });
  expect(await screen.findByLabelText('Restore from backup…')).toBeInTheDocument();
});
