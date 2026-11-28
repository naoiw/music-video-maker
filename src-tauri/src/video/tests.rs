use super::*;

fn overlay(path: &str, opacity: u32) -> OverlayLayer {
    OverlayLayer {
        path: path.into(),
        x: 2500,
        y: 2500,
        width: 5000,
        height: 5000,
        opacity,
    }
}

#[test]
fn validates_overlay_geometry_and_opacity() {
    let mut layer = overlay("test.png", 50);
    assert!(layer.validate().is_ok());
    assert_eq!(
        layer.pixel_rect(OutputSettings::default()),
        (480, 270, 960, 540)
    );
    layer.width = 7501;
    assert!(layer.validate().is_err());
    layer.width = 0;
    assert!(layer.validate().is_err());
    layer.width = 5000;
    layer.opacity = 101;
    assert!(layer.validate().is_err());
    layer.opacity = 0;
    layer.x = u32::MAX;
    assert!(layer.validate().is_err());
}

#[test]
fn layered_arguments_preserve_order_paths_and_audio_mapping() {
    let first = overlay("C:/素材/first %d.png", 100);
    let second = overlay("C:/素材/second.gif", 50);
    let args = encoder_args(
        "music.mp3",
        "base.png",
        VisualKind::Png,
        "out.mp4",
        OutputSettings::default(),
        None,
        &[(&first, VisualKind::Png), (&second, VisualKind::Gif)],
    );
    let paths: Vec<&str> = args
        .windows(2)
        .filter(|pair| pair[0] == "-i")
        .map(|pair| pair[1].as_str())
        .collect();
    assert_eq!(
        paths,
        [
            "base.png",
            "music.mp3",
            first.path.as_str(),
            second.path.as_str()
        ]
    );
    assert!(args.windows(2).any(|pair| pair == ["-map", "[out1]"]));
    assert!(args.windows(2).any(|pair| pair == ["-map", "1:a:0"]));
    assert!(args.windows(2).any(|pair| pair == ["-ignore_loop", "1"]));
    let graph = &args[args
        .iter()
        .position(|arg| arg == "-filter_complex")
        .unwrap()
        + 1];
    assert!(graph.contains("[2:v]"));
    assert!(graph.contains("[3:v]"));
    assert!(graph.contains("[out0][layer1]overlay"));
    assert!(graph.contains("colorchannelmixer=aa=0.5"));
    assert!(!graph.contains(&first.path));
    assert!(!args.iter().any(|arg| arg == "-vf"));
}

#[test]
#[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
fn encodes_ordered_overlays_with_source_alpha() {
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("music.mp3");
    let base = dir.path().join("base.png");
    let first = dir.path().join("first.png");
    let second = dir.path().join("second.png");
    let output = dir.path().join("result.mp4");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.2",
            "-c:a",
            "libmp3lame",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    RgbImage::from_pixel(160, 90, Rgb([0, 0, 255]))
        .save(&base)
        .unwrap();
    RgbImage::from_pixel(100, 100, Rgb([255, 0, 0]))
        .save(&first)
        .unwrap();
    RgbaImage::from_pixel(100, 100, Rgba([0, 255, 0, 128]))
        .save(&second)
        .unwrap();
    let info = encode_video(
        audio.to_str().unwrap(),
        base.to_str().unwrap(),
        output.to_str().unwrap(),
        OutputSettings {
            fit: ImageFit::Contain,
            ..OutputSettings::default()
        },
        &[],
        &[
            overlay(first.to_str().unwrap(), 100),
            overlay(second.to_str().unwrap(), 50),
        ],
        &EncodeJob::default(),
    )
    .unwrap();
    assert!((info.duration_seconds - 1.2).abs() < 0.2);
    let center = sample_color(&output, "0.5");
    // Red covered by 25% green (source alpha 50% × layer opacity 50%).
    assert!(center[0] > 160 && (35..100).contains(&center[1]) && center[2] < 30);
    let corner = sample_color_at(&output, "0.5", "crop=2:2:20:20,format=rgb24");
    assert!(corner[0] < 30 && corner[1] < 30 && corner[2] > 200);
}

#[test]
fn arguments_keep_paths_separate_and_map_only_requested_streams() {
    let args = encoder_args(
        "music file.mp3",
        "cover %d.png",
        VisualKind::Png,
        "temp.mp4",
        OutputSettings::default(),
        None,
        &[],
    );
    assert!(args.windows(2).any(|pair| pair == ["-i", "cover %d.png"]));
    assert!(args.windows(2).any(|pair| pair == ["-i", "music file.mp3"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-pattern_type", "none"]));
    assert!(args.windows(2).any(|pair| pair == ["-map", "1:a:0"]));
    assert!(args.iter().any(|arg| arg == "-shortest"));
    assert_eq!(args.last().map(String::as_str), Some("temp.mp4"));
}

#[test]
fn gif_arguments_ignore_embedded_loop_count() {
    let args = encoder_args(
        "audio.mp3",
        "cover.gif",
        VisualKind::Gif,
        "temp.mp4",
        OutputSettings::default(),
        None,
        &[],
    );
    assert!(args.windows(2).any(|pair| pair == ["-f", "gif"]));
    assert!(args.windows(2).any(|pair| pair == ["-ignore_loop", "1"]));
    assert!(args.windows(2).any(|pair| pair == ["-stream_loop", "-1"]));
    assert!(args.iter().any(|arg| arg.contains("gblur=sigma=")));
    assert!(args
        .iter()
        .any(|arg| arg.contains("overlay=(W-w)/2:(H-h)/2")));
    assert!(!args.iter().any(|arg| arg == "-pattern_type"));
    assert!(args.iter().any(|arg| arg == "-shortest"));
}

#[test]
fn refuses_existing_or_invalid_destination() {
    let dir = tempfile::tempdir().unwrap();
    let existing = dir.path().join("existing.mp4");
    std::fs::write(&existing, b"keep").unwrap();
    assert!(validate_destination(&existing).is_err());
    assert_eq!(std::fs::read(&existing).unwrap(), b"keep");
    assert!(validate_destination(Path::new("relative.mp4")).is_err());
    assert!(validate_destination(&dir.path().join("wrong.wav")).is_err());
    assert!(validate_destination(&dir.path().join("new.mp4")).is_ok());
}

#[test]
fn rejects_unverified_output() {
    assert!(validate_output(b"{}", OutputSettings::default()).is_err());
    assert!(validate_output(
        br#"{"streams":[],"format":{"duration":"2"}}"#,
        OutputSettings::default(),
    )
    .is_err());
    assert!(positive_duration("NaN").is_err());
    assert!(positive_duration("0").is_err());
}

#[test]
#[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
fn encodes_png_and_jpeg() {
    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("music test.mp3");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2.3",
            "-c:a",
            "libmp3lame",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    for extension in ["png", "jpg"] {
        let cover = dir.path().join(format!("cover %d.{extension}"));
        let output = dir.path().join(format!("result {extension}.mp4"));
        image::DynamicImage::new_rgb8(513, 777)
            .save(&cover)
            .unwrap();
        let info = encode_video(
            audio.to_str().unwrap(),
            cover.to_str().unwrap(),
            output.to_str().unwrap(),
            OutputSettings::default(),
            &[],
            &[],
            &EncodeJob::default(),
        )
        .unwrap();
        assert!((info.duration_seconds - 2.3).abs() < 0.2);
        assert!(info.size_bytes > 0);
        assert!(output.is_file());
        assert!(encode_video(
            audio.to_str().unwrap(),
            cover.to_str().unwrap(),
            output.to_str().unwrap(),
            OutputSettings::default(),
            &[],
            &[],
            &EncodeJob::default(),
        )
        .is_err());
    }
}

fn sample_color(path: &Path, timestamp: &str) -> Vec<u8> {
    sample_color_at(path, timestamp, "crop=2:2:960:540,format=rgb24")
}

fn sample_color_at(path: &Path, timestamp: &str, filter: &str) -> Vec<u8> {
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-ss",
            timestamp,
            "-i",
            path.to_str().unwrap(),
            "-frames:v",
            "1",
            "-vf",
            filter,
            "-f",
            "rawvideo",
            "-",
        ])
        .unwrap()
        .stdout
}

#[test]
#[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
fn encodes_gif_with_repeated_animation() {
    use image::codecs::gif::{GifEncoder, Repeat};
    use image::{Delay, Frame, Rgba, RgbaImage};

    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("music test.mp3");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2.3",
            "-c:a",
            "libmp3lame",
            audio.to_str().unwrap(),
        ])
        .unwrap();

    let base = dir.path().join("base.png");
    image::RgbImage::new(160, 90).save(&base).unwrap();

    for (name, repeat) in [
        ("no-loop", None),
        ("finite-loop", Some(Repeat::Finite(1))),
        ("infinite-loop", Some(Repeat::Infinite)),
    ] {
        let cover = dir.path().join(format!("{name}.gif"));
        {
            let mut encoder = GifEncoder::new(std::fs::File::create(&cover).unwrap());
            if let Some(repeat) = repeat {
                encoder.set_repeat(repeat).unwrap();
            }
            for (color, delay) in [([255, 0, 0, 255], 200), ([0, 0, 255, 255], 300)] {
                encoder
                    .encode_frame(Frame::from_parts(
                        RgbaImage::from_pixel(64, 48, Rgba(color)),
                        0,
                        0,
                        Delay::from_numer_denom_ms(delay, 1),
                    ))
                    .unwrap();
            }
        }

        for (mode, fit) in [
            ("contain", ImageFit::Contain),
            ("cover", ImageFit::Cover),
            ("blurred", ImageFit::Blurred),
        ] {
            let output = dir.path().join(format!("{name}-{mode}.mp4"));
            let info = encode_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
                OutputSettings {
                    fit,
                    ..OutputSettings::default()
                },
                &[],
                &[],
                &EncodeJob::default(),
            )
            .unwrap();
            assert!((info.duration_seconds - 2.3).abs() < 0.2);
            assert!(info.size_bytes > 0);

            // Test both foreground and, in blurred mode, background well
            // after the original GIF ends. Do not only probe duration.
            for (timestamp, red) in [
                ("0.1", true),
                ("0.35", false),
                ("1.6", true),
                ("1.85", false),
                ("2.1", true),
            ] {
                let foreground = sample_color(&output, timestamp);
                let mut pixels = vec![foreground];
                if matches!(fit, ImageFit::Blurred) {
                    pixels.push(sample_color_at(
                        &output,
                        timestamp,
                        "crop=2:2:960:50,format=rgb24",
                    ));
                }
                for pixel in pixels {
                    assert_eq!(pixel.len(), 12);
                    if red {
                        assert!(
                            pixel[0] > 200 && pixel[2] < 50,
                            "{name}/{mode}: {timestamp}"
                        );
                    } else {
                        assert!(
                            pixel[2] > 200 && pixel[0] < 50,
                            "{name}/{mode}: {timestamp}"
                        );
                    }
                }
            }
        }

        // The same GIF used as an additional layer must animate beyond
        // the source duration, regardless of its embedded repeat count.
        let output = dir.path().join(format!("{name}-overlay.mp4"));
        let info = encode_video(
            audio.to_str().unwrap(),
            base.to_str().unwrap(),
            output.to_str().unwrap(),
            OutputSettings {
                fit: ImageFit::Contain,
                ..OutputSettings::default()
            },
            &[],
            &[overlay(cover.to_str().unwrap(), 100)],
            &EncodeJob::default(),
        )
        .unwrap();
        assert!((info.duration_seconds - 2.3).abs() < 0.2);
        for (timestamp, red) in [
            ("0.1", true),
            ("0.35", false),
            ("1.6", true),
            ("1.85", false),
            ("2.1", true),
        ] {
            let pixel = sample_color(&output, timestamp);
            assert_eq!(pixel.len(), 12);
            if red {
                assert!(pixel[0] > 200 && pixel[2] < 50, "{name}: {timestamp}");
            } else {
                assert!(pixel[2] > 200 && pixel[0] < 50, "{name}: {timestamp}");
            }
        }
        let corner = sample_color_at(&output, "1.6", "crop=2:2:20:20,format=rgb24");
        assert!(corner.iter().all(|value| *value < 30));
    }
}

#[test]
fn validates_settings_and_generates_fit_filters() {
    let defaults = OutputSettings::default();
    assert!(defaults.validate().is_ok());
    assert_eq!(defaults.filter(), "setsar=1");
    let contain = OutputSettings {
        fit: ImageFit::Contain,
        ..defaults
    };
    assert!(contain.filter().contains("pad=1920:1080"));
    let cover = OutputSettings {
        width: 1080,
        height: 1920,
        fps: 60,
        crf: 16,
        fit: ImageFit::Cover,
    };
    assert!(cover.validate().is_ok());
    assert!(cover.filter().contains("crop=1080:1920"));
    let args = encoder_args("a.mp3", "b.png", VisualKind::Png, "c.mp4", cover, None, &[]);
    for expected in [["-framerate", "60"], ["-r", "60"], ["-crf", "16"]] {
        assert!(args.windows(2).any(|pair| pair == expected));
    }
    let mut invalid = defaults;
    invalid.width = 1;
    assert!(invalid.validate().is_err());
    invalid = defaults;
    invalid.fps = 0;
    assert!(invalid.validate().is_err());
    invalid = defaults;
    invalid.crf = 99;
    assert!(invalid.validate().is_err());
}

#[test]
#[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
fn encodes_custom_output_settings() {
    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("song.mp3");
    let cover = dir.path().join("square.png");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.2",
            "-c:a",
            "libmp3lame",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    let image = image::DynamicImage::new_rgb8(640, 640);
    image.save(&cover).unwrap();
    for (name, settings) in [
        (
            "square",
            OutputSettings {
                width: 1080,
                height: 1080,
                fps: 24,
                crf: 24,
                fit: ImageFit::Contain,
            },
        ),
        (
            "portrait",
            OutputSettings {
                width: 1080,
                height: 1920,
                fps: 60,
                crf: 16,
                fit: ImageFit::Cover,
            },
        ),
    ] {
        let output = dir.path().join(format!("{name}.mp4"));
        let info = encode_video(
            audio.to_str().unwrap(),
            cover.to_str().unwrap(),
            output.to_str().unwrap(),
            settings,
            &[],
            &[],
            &EncodeJob::default(),
        )
        .unwrap();
        assert!((info.duration_seconds - 1.2).abs() < 0.2);
        assert!(info.size_bytes > 0);
    }
}

#[test]
#[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
fn encodes_cancel_and_retry() {
    use std::thread;
    use std::time::{Duration, Instant};

    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("song.mp3");
    let cover = dir.path().join("cover.png");
    let output = dir.path().join("cancelled.mp4");
    let fixture = |duration: &str| {
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                duration,
                "-c:a",
                "libmp3lame",
                audio.to_str().unwrap(),
            ])
            .unwrap();
    };
    fixture("sine=frequency=440:duration=30");
    image::DynamicImage::new_rgb8(640, 480)
        .save(&cover)
        .unwrap();

    let job = EncodeJob::default();
    let result = thread::scope(|scope| {
        let worker = scope.spawn(|| {
            encode_video(
                audio.to_str().unwrap(),
                cover.to_str().unwrap(),
                output.to_str().unwrap(),
                OutputSettings::default(),
                &[],
                &[],
                &job,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(20);
        while job.snapshot().processed_seconds <= 0.0 && Instant::now() < deadline {
            if worker.is_finished() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let saw_progress = job.snapshot().processed_seconds > 0.0;
        let accepted = job.request_cancel();
        let result = worker.join().unwrap();
        assert!(saw_progress);
        assert!(accepted);
        result
    });
    assert_eq!(result.unwrap_err(), encode_job::CANCELLED);
    assert!(!output.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);

    fixture("sine=frequency=440:duration=1.2");
    let info = encode_video(
        audio.to_str().unwrap(),
        cover.to_str().unwrap(),
        output.to_str().unwrap(),
        OutputSettings::default(),
        &[],
        &[],
        &EncodeJob::default(),
    )
    .unwrap();
    assert!(info.size_bytes > 0);
    assert!(output.is_file());
}

#[test]
fn uses_explicit_duration_for_prepared_audio() {
    let args = encoder_args(
        "a.mp3",
        "b.png",
        VisualKind::Png,
        "out.mp4",
        OutputSettings::default(),
        None,
        &[],
    );
    assert!(!args.iter().any(|arg| arg == "-af"));
    let args = encoder_args(
        "filtered.wav",
        "b.png",
        VisualKind::Png,
        "out.mp4",
        OutputSettings::default(),
        Some("3.200000"),
        &[],
    );
    assert!(args.windows(2).any(|pair| pair == ["-f", "wav"]));
    assert!(args.windows(2).any(|pair| pair == ["-t", "3.200000"]));
    assert!(!args.iter().any(|arg| arg == "-shortest" || arg == "-af"));
}

fn audio_rms(path: &Path) -> f64 {
    let output = Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-ss",
            "1",
            "-i",
            path.to_str().unwrap(),
            "-map",
            "0:a:0",
            "-t",
            "1",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-",
        ])
        .unwrap();
    let (samples, remainder) = output.stdout.as_chunks::<4>();
    assert!(remainder.is_empty());
    assert!(!samples.is_empty());
    let sum: f64 = samples
        .iter()
        .map(|sample| f64::from(f32::from_le_bytes(*sample)).powi(2))
        .sum();
    (sum / samples.len() as f64).sqrt()
}

#[test]
#[ignore = "requires FFmpeg with audio filters, libmp3lame, libx264, AAC and FFprobe"]
fn encodes_with_audio_filter_chain() {
    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("song.mp3");
    let image = dir.path().join("cover.png");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=3.2",
            "-c:a",
            "libmp3lame",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    image::DynamicImage::new_rgb8(512, 512)
        .save(&image)
        .unwrap();
    let original_bytes = std::fs::read(&audio).unwrap();
    let settings = OutputSettings {
        width: 1080,
        height: 1080,
        ..OutputSettings::default()
    };
    let cases = [
        ("original", "[]"),
        (
            "disabled",
            r#"[{"enabled":false,"filter":{"kind":"gain","gainDb":-6}}]"#,
        ),
        (
            "gain",
            r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#,
        ),
        (
            "combined",
            r#"[
                {"enabled":true,"filter":{"kind":"noiseReduction","reductionDb":6,"noiseFloorDb":-50}},
                {"enabled":true,"filter":{"kind":"highPass","frequencyHz":80}},
                {"enabled":true,"filter":{"kind":"lowPass","frequencyHz":12000}},
                {"enabled":true,"filter":{"kind":"equalizer","frequencyHz":1000,"q":1,"gainDb":3}},
                {"enabled":true,"filter":{"kind":"gain","gainDb":-6}},
                {"enabled":true,"filter":{"kind":"loudness","targetLufs":-14,"truePeakDb":-1.5}},
                {"enabled":true,"filter":{"kind":"limiter","ceilingDb":-1}}
            ]"#,
        ),
    ];
    let mut levels = Vec::new();
    for (name, json) in cases {
        let filters: Vec<audio_filters::FilterEntry> = serde_json::from_str(json).unwrap();
        let output = dir.path().join(format!("{name}.mp4"));
        let info = encode_video(
            audio.to_str().unwrap(),
            image.to_str().unwrap(),
            output.to_str().unwrap(),
            settings,
            &filters,
            &[],
            &EncodeJob::default(),
        )
        .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert!((info.duration_seconds - 3.2).abs() < 0.2, "{name}");
        levels.push(audio_rms(&output));
    }
    assert!((levels[1] / levels[0] - 1.0).abs() < 0.01);
    assert!((levels[2] / levels[0] - 10_f64.powf(-6.0 / 20.0)).abs() < 0.03);
    assert!(levels[3].is_finite() && levels[3] > 0.0);
    assert_eq!(std::fs::read(&audio).unwrap(), original_bytes);

    let invalid: Vec<audio_filters::FilterEntry> =
        serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":99}}]"#).unwrap();
    let output = dir.path().join("invalid.mp4");
    assert!(encode_video(
        audio.to_str().unwrap(),
        image.to_str().unwrap(),
        output.to_str().unwrap(),
        settings,
        &invalid,
        &[],
        &EncodeJob::default(),
    )
    .is_err());
    assert!(!output.exists());
    assert!(!std::fs::read_dir(dir.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".music-video-maker-")
    }));
}

#[test]
fn accepts_every_supported_output_settings_combination() {
    for (width, height) in [(1920, 1080), (1080, 1080), (1080, 1920)] {
        for fps in [24, 30, 60] {
            for crf in [16, 20, 24] {
                for fit in [ImageFit::Blurred, ImageFit::Contain, ImageFit::Cover] {
                    let settings = OutputSettings {
                        width,
                        height,
                        fps,
                        crf,
                        fit,
                    };
                    assert!(settings.validate().is_ok());
                    let args = encoder_args(
                        "audio.mp3",
                        "cover.png",
                        VisualKind::Png,
                        "out.mp4",
                        settings,
                        None,
                        &[],
                    );
                    for (flag, value) in [
                        ("-r", fps.to_string()),
                        ("-crf", crf.to_string()),
                        ("-c:v", "libx264".into()),
                        ("-c:a", "aac".into()),
                        ("-pix_fmt", "yuv420p".into()),
                        ("-movflags", "+faststart".into()),
                    ] {
                        assert!(args
                            .windows(2)
                            .any(|pair| pair[0] == flag && pair[1] == value));
                    }
                }
            }
        }
    }
}

#[test]
fn output_verification_rejects_each_invalid_stream_property() {
    let valid = serde_json::json!({
        "streams": [
            {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
             "pix_fmt":"yuv420p","r_frame_rate":"30/1","duration":"2.0"},
            {"codec_type":"audio","codec_name":"aac","duration":"2.01"}
        ],
        "format":{"duration":"2.01"}
    });
    let settings = OutputSettings::default();
    let check =
        |value: &serde_json::Value| validate_output(&serde_json::to_vec(value).unwrap(), settings);
    assert_eq!(check(&valid).unwrap(), 2.01);
    for (index, key, value) in [
        (0_usize, "codec_name", serde_json::json!("hevc")),
        (1, "codec_name", serde_json::json!("mp3")),
        (0, "width", serde_json::json!(1080)),
        (0, "height", serde_json::json!(720)),
        (0, "pix_fmt", serde_json::json!("yuv444p")),
        (0, "r_frame_rate", serde_json::json!("60/1")),
        (0, "duration", serde_json::json!("2.4")),
        (1, "duration", serde_json::json!("N/A")),
    ] {
        let mut invalid = valid.clone();
        invalid["streams"][index][key] = value;
        assert!(check(&invalid).is_err(), "{key}");
    }
    let mut extra = valid.clone();
    extra["streams"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({"codec_type":"audio","codec_name":"aac"}));
    assert!(check(&extra).is_err());
    let mut invalid_duration = valid;
    invalid_duration["format"]["duration"] = serde_json::json!("NaN");
    assert!(check(&invalid_duration).is_err());
}

#[test]
#[ignore = "requires FFmpeg with libmp3lame, libx264, AAC and FFprobe"]
fn encodes_after_invalid_sources_and_verifies_published_file() {
    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("音声 test.mp3");
    let cover = dir.path().join("画像 %d.png");
    let output = dir.path().join("出力 test.mp4");
    let audio_path = audio.to_str().unwrap();
    let cover_path = cover.to_str().unwrap();
    let output_path = output.to_str().unwrap();
    let settings = OutputSettings {
        width: 1080,
        height: 1080,
        fps: 24,
        crf: 24,
        fit: ImageFit::Cover,
    };
    let filters: Vec<audio_filters::FilterEntry> =
        serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#).unwrap();
    let encode = || {
        encode_video(
            audio_path,
            cover_path,
            output_path,
            settings,
            &filters,
            &[],
            &EncodeJob::default(),
        )
    };
    image::DynamicImage::new_rgb8(513, 777)
        .save(&cover)
        .unwrap();
    std::fs::write(&audio, b"not an MP3").unwrap();
    assert!(encode().is_err());
    assert!(!output.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);

    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100:duration=1.5",
            "-c:a",
            "libmp3lame",
            audio_path,
        ])
        .unwrap();
    let original = std::fs::read(&audio).unwrap();
    std::fs::write(&cover, b"not a PNG").unwrap();
    assert!(encode().unwrap_err().starts_with("[MVM:INPUT_IMAGE]"));
    assert!(!output.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);

    image::DynamicImage::new_rgb8(513, 777)
        .save(&cover)
        .unwrap();
    let info = encode().unwrap();
    assert!(info.size_bytes > 0);
    assert_eq!(info.size_bytes, std::fs::metadata(&output).unwrap().len());
    // Probe the published MP4 independently of the application's validator.
    let probe = Tool::Ffprobe
        .run(&[
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            output_path,
        ])
        .unwrap();
    let result: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
    let streams = result["streams"].as_array().unwrap();
    assert_eq!(streams.len(), 2);
    let video = streams
        .iter()
        .find(|stream| stream["codec_type"] == "video")
        .unwrap();
    let audio_stream = streams
        .iter()
        .find(|stream| stream["codec_type"] == "audio")
        .unwrap();
    assert_eq!(video["codec_name"], "h264");
    assert_eq!(video["width"], 1080);
    assert_eq!(video["height"], 1080);
    assert_eq!(video["pix_fmt"], "yuv420p");
    assert_eq!(video["r_frame_rate"], "24/1");
    assert_eq!(audio_stream["codec_name"], "aac");
    for stream in [video, audio_stream, &result["format"]] {
        let duration: f64 = stream["duration"].as_str().unwrap().parse().unwrap();
        assert!((duration - 1.5).abs() < 0.2, "{duration}");
    }
    let published = std::fs::read(&output).unwrap();
    assert!(encode().unwrap_err().starts_with("[MVM:OUTPUT_EXISTS]"));
    assert_eq!(std::fs::read(&output).unwrap(), published);
    assert_eq!(std::fs::read(&audio).unwrap(), original);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 3);
}

#[test]
#[ignore = "requires FFmpeg with AAC, libopus, libvpx-vp9, libx264 and FFprobe"]
fn encodes_and_previews_extended_audio_inputs() {
    let dir = tempfile::tempdir().unwrap();
    let image = dir.path().join("cover.png");
    image::RgbImage::new(160, 90).save(&image).unwrap();
    let filters: Vec<audio_filters::FilterEntry> =
        serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#).unwrap();
    for (ext, codec, video_codec) in [
        ("wav", "pcm_s16le", None),
        ("flac", "flac", None),
        ("aac", "aac", None),
        ("m4a", "aac", None),
        ("mp4", "aac", Some("libx264")),
        ("webm", "libopus", Some("libvpx-vp9")),
        ("mov", "aac", Some("libx264")),
        ("mkv", "libopus", Some("libx264")),
    ] {
        let input = dir.path().join(format!("source.{ext}"));
        let path = input.to_str().unwrap();
        let mut args = vec![
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=1.2",
        ];
        if let Some(codec) = video_codec {
            args.extend([
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=160x90:d=1.8",
                "-c:v",
                codec,
            ]);
        }
        args.extend(["-c:a", codec, path]);
        Tool::Ffmpeg.run(&args).unwrap();
        let info = audio::probe_audio(path).unwrap();
        assert!((info.duration_seconds - 1.2).abs() < 0.2, "{ext}");
        crate::audio_preview::render(path, 0.0, &[]).unwrap();
        crate::audio_preview::render(path, 0.0, &filters).unwrap();
        for (name, chain) in [("original", &[][..]), ("filtered", filters.as_slice())] {
            let output = dir.path().join(format!("{ext}-{name}.mp4"));
            let info = encode_video(
                path,
                image.to_str().unwrap(),
                output.to_str().unwrap(),
                OutputSettings {
                    fit: ImageFit::Contain,
                    ..OutputSettings::default()
                },
                chain,
                &[],
                &EncodeJob::default(),
            )
            .unwrap();
            assert!((info.duration_seconds - 1.2).abs() < 0.2, "{ext}/{name}");
            let pixel = sample_color(&output, "0.5");
            assert!(pixel.iter().all(|value| *value < 30), "{ext}/{name}");
        }
    }
}

#[test]
#[ignore = "requires FFmpeg with AAC, libx264, libvpx-vp9, libopus, libwebp and FFprobe"]
fn encodes_extended_visual_inputs_and_silent_video_previews() {
    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("audio.wav");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2.4",
            "-c:a",
            "pcm_s16le",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    let base = dir.path().join("base.png");
    image::RgbImage::new(160, 90).save(&base).unwrap();
    for (ext, codec, audio_codec) in [
        ("mp4", "libx264", "aac"),
        ("webm", "libvpx-vp9", "libopus"),
        ("mov", "libx264", "aac"),
        ("mkv", "libx264", "libopus"),
    ] {
        let path = dir.path().join(format!("source.{ext}"));
        let input = path.to_str().unwrap();
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=red:s=160x90:r=10:d=0.4",
                "-f",
                "lavfi",
                "-i",
                "color=blue:s=160x90:r=10:d=0.4",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=880:sample_rate=48000:duration=0.8",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                "-map",
                "[v]",
                "-map",
                "2:a:0",
                "-c:v",
                codec,
                "-c:a",
                audio_codec,
                input,
            ])
            .unwrap();
        visual::load_visual(input).unwrap();
        for (name, visual_path, layers, fit) in [
            ("base", input, vec![], ImageFit::Blurred),
            (
                "overlay",
                base.to_str().unwrap(),
                vec![overlay(input, 100)],
                ImageFit::Contain,
            ),
        ] {
            let output = dir.path().join(format!("{ext}-{name}.mp4"));
            let info = encode_video(
                audio.to_str().unwrap(),
                visual_path,
                output.to_str().unwrap(),
                OutputSettings {
                    fit,
                    ..OutputSettings::default()
                },
                &[],
                &layers,
                &EncodeJob::default(),
            )
            .unwrap();
            assert!((info.duration_seconds - 2.4).abs() < 0.2, "{ext}/{name}");
            for (time, red) in [("0.2", true), ("0.6", false), ("1.0", true), ("1.4", false)] {
                let pixel = sample_color(&output, time);
                assert_eq!(pixel.len(), 12);
                if red {
                    assert!(pixel[0] > 150 && pixel[2] < 100, "{ext}/{name}/{time}");
                } else {
                    assert!(pixel[2] > 150 && pixel[0] < 100, "{ext}/{name}/{time}");
                }
            }
        }
    }
    let webp = dir.path().join("cover.webp");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=green:s=160x90",
            "-frames:v",
            "1",
            "-c:v",
            "libwebp",
            webp.to_str().unwrap(),
        ])
        .unwrap();
    for fit in [ImageFit::Contain, ImageFit::Cover, ImageFit::Blurred] {
        let output = dir.path().join(format!("webp-{fit:?}.mp4"));
        let info = encode_video(
            audio.to_str().unwrap(),
            webp.to_str().unwrap(),
            output.to_str().unwrap(),
            OutputSettings {
                fit,
                ..OutputSettings::default()
            },
            &[],
            &[],
            &EncodeJob::default(),
        )
        .unwrap();
        assert!((info.duration_seconds - 2.4).abs() < 0.2);
        let pixel = sample_color(&output, "1.0");
        assert!(pixel[1] > 90 && pixel[0] < 40 && pixel[2] < 40);
    }
    assert!(visual::load_visual(audio.to_str().unwrap()).is_err());
    assert!(audio::probe_audio(webp.to_str().unwrap()).is_err());
}

fn tone_amplitude(path: &Path, frequency: f64) -> f64 {
    let output = Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-ss",
            "0.5",
            "-i",
            path.to_str().unwrap(),
            "-map",
            "0:a:0",
            "-t",
            "1",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-c:a",
            "pcm_f32le",
            "-f",
            "f32le",
            "-",
        ])
        .unwrap();
    let (samples, remainder) = output.stdout.as_chunks::<4>();
    assert!(remainder.is_empty() && samples.len() > 20_000);
    let (mut sin, mut cos) = (0.0, 0.0);
    for (index, sample) in samples.iter().enumerate() {
        let value = f64::from(f32::from_le_bytes(*sample));
        let angle = std::f64::consts::TAU * frequency * index as f64 / 48_000.0;
        sin += value * angle.sin();
        cos += value * angle.cos();
    }
    2.0 * sin.hypot(cos) / samples.len() as f64
}

#[test]
#[ignore = "requires FFmpeg with libx264, libvpx-vp9, libopus, AAC and FFprobe"]
fn combines_independent_video_layers_and_uses_only_selected_audio() {
    let dir = tempfile::tempdir().unwrap();
    let audio = dir.path().join("audio.webm");
    // A live WebM has neither stream nor container duration metadata.
    // The unrelated video is longer than the selected 1.6 s audio stream.
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=white:s=160x90:d=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=1.6",
            "-c:v",
            "libvpx-vp9",
            "-c:a",
            "libopus",
            "-live",
            "1",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    let info = audio::probe_audio(audio.to_str().unwrap()).unwrap();
    assert!((info.duration_seconds - 1.6).abs() < 0.05);
    let base = dir.path().join("base.mp4");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=green:s=160x90:d=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1760:sample_rate=48000:duration=3",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            base.to_str().unwrap(),
        ])
        .unwrap();
    let lower = dir.path().join("lower.mp4");
    let upper = dir.path().join("upper.mp4");
    for (path, first, second, frequency) in [
        (
            &lower,
            "color=red:s=160x90:r=10:d=0.4",
            "color=blue:s=160x90:r=10:d=0.4",
            "sine=frequency=880:duration=2.6",
        ),
        (
            &upper,
            "color=yellow:s=160x90:r=10:d=0.6",
            "color=magenta:s=160x90:r=10:d=0.6",
            "sine=frequency=1320:duration=1.2",
        ),
    ] {
        Tool::Ffmpeg
            .run(&[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                first,
                "-f",
                "lavfi",
                "-i",
                second,
                "-f",
                "lavfi",
                "-i",
                frequency,
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                "-map",
                "[v]",
                "-map",
                "2:a:0",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                path.to_str().unwrap(),
            ])
            .unwrap();
    }
    let first = overlay(lower.to_str().unwrap(), 100);
    let mut second = overlay(upper.to_str().unwrap(), 100);
    second.x = 5000;
    second.width = 2500;
    let output = dir.path().join("combined.mp4");
    let filters: Vec<audio_filters::FilterEntry> =
        serde_json::from_str(r#"[{"enabled":true,"filter":{"kind":"gain","gainDb":-6}}]"#).unwrap();
    let result = encode_video(
        audio.to_str().unwrap(),
        base.to_str().unwrap(),
        output.to_str().unwrap(),
        OutputSettings {
            fit: ImageFit::Contain,
            ..OutputSettings::default()
        },
        &filters,
        &[first, second],
        &EncodeJob::default(),
    )
    .unwrap();
    assert!((result.duration_seconds - 1.6).abs() < 0.2);
    for (time, red) in [
        ("0.2", true),
        ("0.55", false),
        ("1.05", true),
        ("1.4", false),
    ] {
        let pixel = sample_color_at(&output, time, "crop=2:2:700:540,format=rgb24");
        assert_eq!(pixel.len(), 12);
        if red {
            assert!(pixel[0] > 150 && pixel[2] < 100, "lower {time}");
        } else {
            assert!(pixel[2] > 150 && pixel[0] < 100, "lower {time}");
        }
    }
    for (time, yellow) in [("0.2", true), ("0.85", false), ("1.4", true)] {
        let pixel = sample_color_at(&output, time, "crop=2:2:1150:540,format=rgb24");
        assert_eq!(pixel.len(), 12);
        assert!(pixel[0] > 150, "upper {time}");
        if yellow {
            assert!(pixel[1] > 150 && pixel[2] < 100, "upper {time}");
        } else {
            assert!(pixel[2] > 150 && pixel[1] < 100, "upper {time}");
        }
    }
    let corner = sample_color_at(&output, "1.4", "crop=2:2:20:20,format=rgb24");
    assert!(corner[1] > 90 && corner[0] < 40 && corner[2] < 40);
    // 440 Hz is the only allowed audio, reduced by the selected gain filter.
    let wanted = tone_amplitude(&output, 440.0);
    assert!((0.04..0.09).contains(&wanted), "{wanted}");
    for unwanted in [880.0, 1320.0, 1760.0] {
        assert!(tone_amplitude(&output, unwanted) < 0.01, "{unwanted}");
    }
}

#[test]
#[ignore = "requires FFmpeg with libx264, AAC and FFprobe"]
fn rejects_wrong_streams_disguised_formats_and_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("video-only.mp4");
    let audio = dir.path().join("audio-only.mp4");
    let broken = dir.path().join("broken.mp4");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=blue:s=160x90:d=0.5",
            "-c:v",
            "libx264",
            video.to_str().unwrap(),
        ])
        .unwrap();
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=32000:duration=1.2",
            "-ac",
            "2",
            "-c:a",
            "aac",
            audio.to_str().unwrap(),
        ])
        .unwrap();
    std::fs::write(&broken, b"not a video").unwrap();
    assert!(audio::probe_audio(video.to_str().unwrap()).is_err());
    assert!(visual::load_visual(audio.to_str().unwrap()).is_err());
    assert!(audio::probe_audio(broken.to_str().unwrap()).is_err());
    assert!(visual::load_visual(broken.to_str().unwrap()).is_err());
    let disguised = dir.path().join("disguised.flac");
    std::fs::copy(&audio, &disguised).unwrap();
    assert!(audio::probe_audio(disguised.to_str().unwrap()).is_err());
    let disguised = dir.path().join("disguised.webp");
    std::fs::copy(&video, &disguised).unwrap();
    assert!(visual::load_visual(disguised.to_str().unwrap()).is_err());
    let info = audio::probe_audio(audio.to_str().unwrap()).unwrap();
    assert_eq!((info.sample_rate, info.channels), (32_000, 2));
    let attached = dir.path().join("attached-cover.mp4");
    Tool::Ffmpeg
        .run(&[
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=32000:duration=1.2",
            "-f",
            "lavfi",
            "-i",
            "color=yellow:s=160x90:d=0.04",
            "-map",
            "0:a:0",
            "-map",
            "1:v:0",
            "-c:a",
            "aac",
            "-c:v",
            "mjpeg",
            "-disposition:v",
            "attached_pic",
            attached.to_str().unwrap(),
        ])
        .unwrap();
    assert!(audio::probe_audio(attached.to_str().unwrap()).is_ok());
    assert!(visual::load_visual(attached.to_str().unwrap()).is_err());
    let output = dir.path().join("retry.mp4");
    let settings = OutputSettings {
        fit: ImageFit::Cover,
        ..OutputSettings::default()
    };
    assert!(encode_video(
        audio.to_str().unwrap(),
        broken.to_str().unwrap(),
        output.to_str().unwrap(),
        settings,
        &[],
        &[],
        &EncodeJob::default(),
    )
    .is_err());
    assert!(!output.exists());
    let info = encode_video(
        audio.to_str().unwrap(),
        video.to_str().unwrap(),
        output.to_str().unwrap(),
        settings,
        &[],
        &[],
        &EncodeJob::default(),
    )
    .unwrap();
    assert!((info.duration_seconds - 1.2).abs() < 0.2);
}
