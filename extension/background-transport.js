export function registerTrainingMessages(runtime, service) {
  runtime.onMessage.addListener(async (command, sender) => {
    if (!sender || sender.id !== runtime.id) {
      return { ok: false, error: 'Доступ разрешён только страницам этого расширения.' };
    }
    try {
      return { ok: true, data: await service.handle(command) };
    } catch (error) {
      const reply = { ok: false, error: error instanceof Error ? error.message : 'Не удалось сохранить журнал. Повторите попытку.' };
      // Only a string code travels; storage errors carry numeric ones that mean nothing to a page.
      if (typeof error?.code === 'string') reply.code = error.code;
      return reply;
    }
  });
}
