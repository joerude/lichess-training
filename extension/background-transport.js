export function registerTrainingMessages(runtime, service) {
  runtime.onMessage.addListener(async (command, sender) => {
    if (!sender || sender.id !== runtime.id) {
      return { ok: false, error: 'Доступ разрешён только страницам этого расширения.' };
    }
    try {
      return { ok: true, data: await service.handle(command) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Не удалось сохранить журнал. Повторите попытку.' };
    }
  });
}
