import { describe, it, expect, beforeEach } from 'vitest';
import { RegistrarActividadTutorUseCase } from '../../../src/L2_application/use-cases/registrar-actividad-tutor.use-case';
import { GetActividadTutorUseCase } from '../../../src/L2_application/use-cases/get-actividad-tutor.use-case';
import { ArchivarActividadTutorUseCase } from '../../../src/L2_application/use-cases/archivar-actividad-tutor.use-case';
import { TutorActivityStorage } from '../../../src/L1_domain/ports/tutor-activity-storage';
import { TutorActivityEvent } from '../../../src/L1_domain/value-objects/tutor-activity-event';

// Fake in-memory con la misma semántica idempotente que el adapter IDB:
// segundo append con el mismo id sobrescribe.
class InMemoryTutorActivityStorage implements TutorActivityStorage {
  private readonly events = new Map<string, TutorActivityEvent>();

  async append(event: TutorActivityEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async list(): Promise<TutorActivityEvent[]> {
    return Array.from(this.events.values());
  }

  async archive(eventId: string): Promise<void> {
    const existing = this.events.get(eventId);
    if (!existing) return;
    this.events.set(eventId, { ...existing, archived: true });
  }

  async wipeUserScope(): Promise<void> {
    this.events.clear();
  }
}

function buildEvent(overrides: Partial<TutorActivityEvent> = {}): TutorActivityEvent {
  return {
    id: 'ev-1',
    recordId: 'rec-1',
    examName: 'Anatomía sem1',
    courseName: 'Anatomía',
    finalizedAt: new Date('2026-07-27T10:47:00.000Z'),
    archived: false,
    ...overrides,
  };
}

describe('RegistrarActividadTutorUseCase', () => {
  let storage: InMemoryTutorActivityStorage;
  let useCase: RegistrarActividadTutorUseCase;

  beforeEach(() => {
    storage = new InMemoryTutorActivityStorage();
    useCase = new RegistrarActividadTutorUseCase(storage);
  });

  it('persiste el evento en el storage', async () => {
    const event = buildEvent();
    await useCase.execute(event);

    const stored = await storage.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('ev-1');
    expect(stored[0].examName).toBe('Anatomía sem1');
  });

  it('es idempotente por id — segundo append con el mismo id no duplica', async () => {
    await useCase.execute(buildEvent({ id: 'finalize.rec-1' }));
    await useCase.execute(buildEvent({ id: 'finalize.rec-1', examName: 'Sobrescrito' }));

    const stored = await storage.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].examName).toBe('Sobrescrito');
  });
});

describe('GetActividadTutorUseCase', () => {
  let storage: InMemoryTutorActivityStorage;
  let useCase: GetActividadTutorUseCase;

  beforeEach(() => {
    storage = new InMemoryTutorActivityStorage();
    useCase = new GetActividadTutorUseCase(storage);
  });

  it('lista vacía cuando no hay eventos', async () => {
    expect(await useCase.execute()).toEqual([]);
  });

  it('excluye eventos archivados', async () => {
    await storage.append(buildEvent({ id: 'a', examName: 'Visible' }));
    await storage.append(buildEvent({ id: 'b', examName: 'Oculto', archived: true }));

    const events = await useCase.execute();

    expect(events).toHaveLength(1);
    expect(events[0].examName).toBe('Visible');
  });

  it('ordena por finalizedAt descendente (más reciente primero)', async () => {
    await storage.append(
      buildEvent({ id: 'old', examName: 'Viejo', finalizedAt: new Date('2026-07-20T10:00:00Z') }),
    );
    await storage.append(
      buildEvent({ id: 'new', examName: 'Nuevo', finalizedAt: new Date('2026-07-27T10:00:00Z') }),
    );

    const events = await useCase.execute();

    expect(events[0].id).toBe('new');
    expect(events[1].id).toBe('old');
  });
});

describe('ArchivarActividadTutorUseCase', () => {
  let storage: InMemoryTutorActivityStorage;
  let useCase: ArchivarActividadTutorUseCase;

  beforeEach(() => {
    storage = new InMemoryTutorActivityStorage();
    useCase = new ArchivarActividadTutorUseCase(storage);
  });

  it('marca el evento como archived=true', async () => {
    await storage.append(buildEvent({ id: 'e1' }));

    await useCase.execute('e1');

    const stored = await storage.list();
    expect(stored[0].archived).toBe(true);
  });

  it('no-op si el eventId no existe (defensivo)', async () => {
    await expect(useCase.execute('inexistente')).resolves.toBeUndefined();
  });
});
