document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    const status = document.getElementById(button.dataset.status);
    try {
      await navigator.clipboard.writeText(target.textContent);
      status.textContent = 'Скопировано.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Текст выделен. Скопируй его через Ctrl+C или Cmd+C.';
    }
  });
});

document.querySelectorAll('form.quiz').forEach(form => {
  form.addEventListener('submit', event => {
    event.preventDefault();
    const selected = form.querySelector('input:checked');
    const feedback = form.querySelector('.feedback');
    if (!selected) {
      feedback.dataset.result = 'pending';
      feedback.textContent = 'Сначала выбери ответ.';
      return;
    }
    const correct = selected.value === form.dataset.answer;
    feedback.dataset.result = correct ? 'correct' : 'incorrect';
    feedback.textContent = correct ? form.dataset.correct : form.dataset.incorrect;
  });
});
