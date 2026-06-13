use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, Ordering, fence};

// 单写者(音频线程) + 单读者(UI线程) 的泛型 SeqLock
pub struct SeqLock<T: Copy> {
    seq: AtomicU32,
    data: UnsafeCell<T>,
}

unsafe impl<T: Copy + Send> Sync for SeqLock<T> {}

impl<T: Copy> SeqLock<T> {
    pub fn new(initial: T) -> Self {
        Self {
            seq: AtomicU32::new(0),
            data: UnsafeCell::new(initial),
        }
    }

    // 仅音频线程调用
    pub fn write(&self, value: &T) {
        let s = self.seq.load(Ordering::Relaxed);
        self.seq.store(s.wrapping_add(1), Ordering::Release);
        fence(Ordering::Release);
        unsafe {
            *self.data.get() = *value;
        }
        self.seq.store(s.wrapping_add(2), Ordering::Release);
    }

    // 仅 UI 线程调用
    pub fn read(&self) -> T {
        loop {
            let s1 = self.seq.load(Ordering::Acquire);
            if s1 & 1 != 0 {
                std::hint::spin_loop();
                continue;
            }
            let frame = unsafe { *self.data.get() };
            fence(Ordering::Acquire);
            let s2 = self.seq.load(Ordering::Acquire);
            if s1 == s2 {
                return frame;
            }
        }
    }
}
