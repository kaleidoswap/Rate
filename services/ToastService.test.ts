import ToastService from './ToastService';

describe('ToastService auto-dismiss', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    ToastService.getInstance().dismissAll();
    jest.useRealTimers();
  });

  it('tells the screen when a toast times out, then shows the next one', () => {
    const seen: Array<string | null> = [];
    const unsubscribe = ToastService.getInstance().subscribe((t) => seen.push(t ? t.message : null));
    ToastService.getInstance().success('first', 1000);
    ToastService.getInstance().info('second', 1000);
    expect(seen).toEqual(['first']);
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual(['first', null]);
    jest.advanceTimersByTime(300);
    expect(seen).toEqual(['first', null, 'second']);
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual(['first', null, 'second', null]);
    unsubscribe();
  });
});
