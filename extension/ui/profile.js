import { setTimeZone, systemTimeZone, zoneLabel } from './time-zone.js';

export const RESET_WORD = 'удалить';

export const PROFILE_HINT = 'Логин нужен, чтобы загружать ваши партии и считать задачи по публичному профилю Lichess. Пароль и токен не нужны.';

// Every zone the browser knows, plus the system one and UTC when the list lacks them.
export function timeZoneOptions(supported = Intl.supportedValuesOf('timeZone'), system = systemTimeZone()) {
  const zones = new Set(supported);
  zones.add(system);
  zones.add('UTC');
  return [...zones].sort();
}

function node(document, tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function field(document, id, labelText, control) {
  const wrap = node(document, 'div');
  const label = node(document, 'label', labelText);
  label.htmlFor = id;
  control.id = id;
  wrap.append(label, control);
  return wrap;
}

function hint(document, text) {
  const details = node(document, 'details', undefined, 'hint');
  const summary = node(document, 'summary', '?');
  summary.setAttribute('aria-label', 'Подробнее');
  details.append(summary, node(document, 'div', text, 'hint-body'));
  return details;
}

// The first-run form: asks for the Lichess login and the time zone and sets the profile up.
export function mountProfileSetup({ client, container, document = globalThis.document, location = globalThis.location, zones = timeZoneOptions(), system = systemTimeZone() }) {
  container.replaceChildren();
  const heading = node(document, 'h2', 'Ваш профиль Lichess', 'label');
  heading.id = 'profile-setup-heading';
  container.setAttribute('aria-labelledby', heading.id);
  const top = node(document, 'div', undefined, 'card-title');
  top.append(heading, hint(document, PROFILE_HINT));

  const username = node(document, 'input');
  username.type = 'text';
  username.name = 'username';
  username.required = true;
  username.maxLength = 30;
  username.autocomplete = 'off';
  username.spellcheck = false;
  username.placeholder = 'например, magnus_fan';
  username.autofocus = true;
  const usernameHint = node(document, 'p', 'Латинские буквы, цифры, «_» и «-», от 2 до 30 символов. Регистр не важен.', 'caption');
  usernameHint.id = 'profile-username-hint';
  username.setAttribute('aria-describedby', usernameHint.id);
  const clearInvalid = () => {
    username.removeAttribute('aria-invalid');
    username.setAttribute('aria-describedby', usernameHint.id);
  };
  username.addEventListener('input', clearInvalid);

  const timeZone = node(document, 'select');
  timeZone.name = 'timeZone';
  for (const zone of zones) {
    const option = node(document, 'option', zone);
    option.value = zone;
    timeZone.append(option);
  }
  timeZone.value = system;
  const zoneHint = node(document, 'p', 'По нему считается начало дня и показывается время. По умолчанию — пояс этого компьютера.', 'caption');
  zoneHint.id = 'profile-zone-hint';
  timeZone.setAttribute('aria-describedby', zoneHint.id);

  const error = node(document, 'p', undefined, 'message message-error');
  error.id = 'profile-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const submit = node(document, 'button', 'Начать', 'button button-primary');
  submit.type = 'submit';
  const form = node(document, 'form', undefined, 'profile-form');
  form.id = 'profile-setup-form';
  const actions = node(document, 'div', undefined, 'form-actions');
  actions.append(submit);
  form.append(field(document, 'profile-username', 'Логин на Lichess', username), usernameHint,
    field(document, 'profile-time-zone', 'Часовой пояс', timeZone), zoneHint, error, actions);
  container.append(top, form);
  container.hidden = false;
  username.focus?.();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    error.hidden = true;
    clearInvalid();
    try {
      await client.request({ type: 'profile.setup', username: username.value.trim(), timeZone: timeZone.value });
      location.reload();
    } catch (failure) {
      error.textContent = failure.message || 'Не удалось сохранить профиль.';
      error.hidden = false;
      username.setAttribute('aria-invalid', 'true');
      username.setAttribute('aria-describedby', `${error.id} ${usernameHint.id}`);
      submit.disabled = false;
    }
  });
  return { form, username, timeZone, error, submit };
}

// Only the setup form can work without a profile, so the other modules mount after this answers.
// Returns the profile, or null when the form was shown instead.
export async function startWithProfile({ client, container, document = globalThis.document, location = globalThis.location, mount, onDamaged }) {
  let profile;
  try {
    ({ profile } = await client.request({ type: 'profile.get' }));
  } catch (error) {
    const box = node(document, 'p', `${error.message || 'Не удалось открыть журнал.'} Откройте журнал заново.`, 'message message-error');
    box.id = 'profile-error';
    box.setAttribute('role', 'alert');
    container.replaceChildren(box);
    container.hidden = false;
    // The journal cannot be read, so the only way on is to start over; the caller shows the reset section.
    onDamaged?.();
    return null;
  }
  if (profile === null) {
    mountProfileSetup({ client, container, document, location });
    return null;
  }
  setTimeZone(profile.timeZone);
  mount?.(profile);
  return profile;
}

export function formatProfile(profile) {
  return `Логин: ${profile.username} · Часовой пояс: ${profile.timeZone} (${zoneLabel(profile.timeZone)})`;
}

// The "Профиль" section: shows the login and the zone and, after typing the word, deletes everything and starts over.
export function mountProfileSection({ client, profile, document = globalThis.document, location = globalThis.location, setExternalBusy = () => {} }) {
  const element = (id) => document.getElementById(id);
  const word = element('profile-reset-word');
  const button = element('profile-reset');
  const error = element('profile-reset-error');
  element('profile-summary').textContent = profile ? formatProfile(profile) : 'Профиль не удалось прочитать из журнала.';
  let running = false;
  button.addEventListener('click', async () => {
    if (running) return;
    error.hidden = true;
    if (word.value.trim().toLowerCase() !== RESET_WORD) {
      error.textContent = `Чтобы удалить данные, введите слово «${RESET_WORD}».`;
      error.hidden = false;
      return;
    }
    running = true;
    button.disabled = true;
    setExternalBusy(true);
    try {
      await client.request({ type: 'profile.reset', confirm: RESET_WORD });
      location.reload();
    } catch (failure) {
      error.textContent = failure.message || 'Не удалось удалить данные.';
      error.hidden = false;
      running = false;
      button.disabled = false;
      setExternalBusy(false);
    }
  });
}
