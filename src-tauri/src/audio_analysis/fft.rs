//! Fixed-size real-input FFT for the analysis display; no native DSP dependency.

pub(super) const SIZE: usize = 4096;
pub(super) const BINS: usize = SIZE / 2 + 1;

pub(super) struct Spectrum {
    real: Vec<f64>,
    imag: Vec<f64>,
    roots: Vec<(f64, f64)>,
    window: Vec<f64>,
    power: Vec<f64>,
    frames: usize,
}

fn hann(i: usize, length: usize) -> f64 {
    // Periodic Hann; a one-sample excerpt needs a nonzero window.
    if length <= 1 {
        1.0
    } else {
        0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / length as f64).cos()
    }
}

impl Spectrum {
    pub(super) fn new() -> Self {
        Self {
            real: vec![0.0; SIZE],
            imag: vec![0.0; SIZE],
            roots: (0..SIZE / 2)
                .map(|i| {
                    let angle = -std::f64::consts::TAU * i as f64 / SIZE as f64;
                    (angle.cos(), angle.sin())
                })
                .collect(),
            window: (0..SIZE).map(|i| hann(i, SIZE)).collect(),
            power: vec![0.0; BINS],
            frames: 0,
        }
    }

    // Non-overlapping Hann windows; average power in the linear domain.
    // Each stereo channel is transformed independently, not downmixed.
    pub(super) fn add(&mut self, samples: &[f32], channels: usize) {
        let frames = samples.len() / channels;
        if frames == 0 {
            return;
        }
        let partial;
        let window = if frames == SIZE {
            &self.window
        } else {
            partial = (0..frames).map(|i| hann(i, frames)).collect();
            &partial
        };
        let energy: f64 = window.iter().map(|value| value * value).sum();
        let weight = frames as f64 / (channels as f64 * SIZE as f64 * energy);
        for channel in 0..channels {
            self.real.fill(0.0);
            self.imag.fill(0.0);
            for (i, frame) in samples.chunks_exact(channels).enumerate() {
                self.real[i] = f64::from(frame[channel]) * window[i];
            }
            fft(&mut self.real, &mut self.imag, &self.roots);
            for (i, power) in self.power.iter_mut().enumerate() {
                let factor = if i == 0 || i == SIZE / 2 { 1.0 } else { 2.0 };
                *power +=
                    factor * (self.real[i] * self.real[i] + self.imag[i] * self.imag[i]) * weight;
            }
        }
        self.frames += frames;
    }

    pub(super) fn finish(self) -> Vec<f64> {
        self.power
            .into_iter()
            .map(|power| 10.0 * (power / self.frames.max(1) as f64).max(1e-16).log10())
            .collect()
    }
}

fn fft(real: &mut [f64], imag: &mut [f64], roots: &[(f64, f64)]) {
    let mut j = 0;
    for i in 1..SIZE {
        let mut bit = SIZE / 2;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            real.swap(i, j);
            imag.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= SIZE {
        let half = len / 2;
        let step = SIZE / len;
        for start in (0..SIZE).step_by(len) {
            for k in 0..half {
                let a = start + k;
                let b = a + half;
                let (cos, sin) = roots[k * step];
                let re = real[b] * cos - imag[b] * sin;
                let im = real[b] * sin + imag[b] * cos;
                real[b] = real[a] - re;
                imag[b] = imag[a] - im;
                real[a] += re;
                imag[a] += im;
            }
        }
        len *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locates_tone_and_preserves_antiphase_stereo() {
        let mut samples = Vec::new();
        for i in 0..SIZE {
            let value = (std::f64::consts::TAU * 85.0 * i as f64 / SIZE as f64).sin() as f32;
            samples.extend([value, -value]);
        }
        let mut original = Spectrum::new();
        original.add(&samples, 2);
        let original = original.finish();
        let peak = original
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert_eq!(peak, 85);
        assert!((original[85] + 4.7712).abs() < 0.01);
        let mut quieter = Spectrum::new();
        for value in &mut samples {
            *value *= 0.5;
        }
        quieter.add(&samples, 2);
        assert!((quieter.finish()[85] - original[85] + 6.0206).abs() < 0.01);
    }

    #[test]
    fn silence_and_short_final_window_are_finite() {
        let mut spectrum = Spectrum::new();
        spectrum.add(&[0.0; 3], 1);
        assert!(spectrum.finish().iter().all(|value| *value == -160.0));
        let mut spectrum = Spectrum::new();
        spectrum.add(&[1.0], 1);
        assert!(spectrum.finish().iter().all(|value| value.is_finite()));
    }
}
