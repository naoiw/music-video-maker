//! FFmpeg input arguments, filter graphs and output stream mapping.

use super::{ImageFit, OutputSettings, OverlayLayer};

#[derive(Clone, Copy)]
pub(super) enum VisualKind {
    Png,
    Jpeg,
    Gif,
    WebP,
    Video,
    Visualizer,
}

impl VisualKind {
    pub(super) fn is_animated(self) -> bool {
        matches!(self, Self::Gif | Self::Video)
    }

    fn stream(self) -> &'static str {
        if matches!(self, Self::Video) {
            "V:0"
        } else {
            "v:0"
        }
    }

    pub(super) fn from_format(format: &str) -> Result<Self, String> {
        match format {
            "PNG" => Ok(Self::Png),
            "JPEG" => Ok(Self::Jpeg),
            "GIF" => Ok(Self::Gif),
            "WebP" => Ok(Self::WebP),
            "MP4" | "WebM" | "MOV" | "MKV" => Ok(Self::Video),
            _ => Err(crate::errors::tagged(
                "INPUT_IMAGE",
                "非対応の画像形式です。",
            )),
        }
    }
}

fn visual_input_args(path: &str, source: VisualKind, fps: &str) -> Vec<String> {
    let mut args = vec!["-protocol_whitelist", "file"];
    match source {
        VisualKind::Gif => args.extend(["-f", "gif", "-ignore_loop", "0"]),
        VisualKind::Visualizer => args.extend(["-f", "matroska"]),
        VisualKind::Video => args.extend([
            "-format_whitelist",
            crate::visual::VIDEO_FORMATS,
            "-stream_loop",
            "-1",
        ]),
        VisualKind::Png | VisualKind::Jpeg | VisualKind::WebP => {
            let codec = match source {
                VisualKind::Png => "png",
                VisualKind::WebP => "webp",
                _ => "mjpeg",
            };
            args.extend([
                "-f",
                "image2",
                "-pattern_type",
                "none",
                "-loop",
                "1",
                "-framerate",
                fps,
                "-c:v",
                codec,
            ]);
        }
    }
    args.extend(["-i", path]);
    args.into_iter().map(str::to_owned).collect()
}

fn layered_filter(
    base_filter: &str,
    source: VisualKind,
    overlays: &[(&OverlayLayer, VisualKind)],
    settings: OutputSettings,
) -> (String, String) {
    // Normalize the base cadence before framesync so a slow GIF background
    // does not limit the update rate of foreground animations.
    let fps = settings.fps;
    let stream = if matches!(source, VisualKind::Video) {
        "V:0"
    } else {
        "v"
    };
    let mut graph = format!("[0:{stream}]{base_filter},fps={fps},setpts=PTS-STARTPTS[base]");
    let mut previous = "base".to_owned();
    for (index, (layer, kind)) in overlays.iter().enumerate() {
        let input = index + 2; // 0: base visual, 1: audio.
        let stream = if matches!(kind, VisualKind::Video) {
            "V:0"
        } else {
            "v"
        };
        let (x, y, width, height) = layer.pixel_rect(settings);
        let alpha = f64::from(layer.opacity) / 100.0;
        use std::fmt::Write;
        if let Some(config) = &layer.visualizer {
            let key = if config.transparent {
                "format=rgb24,colorkey=0x000000:0.01:0,format=rgba"
            } else {
                "format=rgba"
            };
            write!(
                graph,
                ";[{input}:v]setpts=PTS-STARTPTS,{key},scale={width}:{height},setsar=1,\
                 colorchannelmixer=aa={alpha}[layer{index}];\
                 [{previous}][layer{index}]overlay=x={x}:y={y}:\
                 shortest=0:eof_action=pass:repeatlast=0:format=auto[out{index}]"
            )
            .expect("writing to a String cannot fail");
            previous = format!("out{index}");
            continue;
        }
        write!(
            graph,
            ";[{input}:{stream}]setpts=PTS-STARTPTS,format=rgba,\
             scale=w='max(1,min({width},iw*{height}/ih))':\
             h='max(1,min({height},ih*{width}/iw))',setsar=1,\
             colorchannelmixer=aa={alpha}[layer{index}];\
             [{previous}][layer{index}]overlay=x={x}+({width}-w)/2:\
             y={y}+({height}-h)/2:shortest=1:format=auto[out{index}]"
        )
        .expect("writing to a String cannot fail");
        previous = format!("out{index}");
    }
    (graph, format!("[{previous}]"))
}

// Original audio must be read to EOF; cap only the infinite visual stream.
// Prepared PCM has an independently measured duration and can use output -t.
#[derive(Clone, Copy)]
pub(super) enum AudioTiming<'a> {
    Original(&'a str),
    Prepared(&'a str),
}

pub(super) fn encoder_args(
    audio_path: &str,
    visual_path: &str,
    source: VisualKind,
    temporary_path: &str,
    settings: OutputSettings,
    timing: AudioTiming<'_>,
    overlays: &[(&OverlayLayer, VisualKind)],
) -> Vec<String> {
    let fps = settings.fps.to_string();
    let filter = if source.is_animated() && matches!(settings.fit, ImageFit::Blurred) {
        settings.animated_blurred_filter()
    } else {
        settings.filter()
    };
    let mut args: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-nostats",
        "-progress",
        "pipe:1",
        "-xerror",
        "-y", // Only the private temporary file can be overwritten.
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    args.extend(visual_input_args(visual_path, source, &fps));
    args.extend(
        [
            "-protocol_whitelist",
            "file",
            if matches!(timing, AudioTiming::Prepared(_)) {
                "-f"
            } else {
                "-format_whitelist"
            },
            if matches!(timing, AudioTiming::Prepared(_)) {
                "wav"
            } else {
                crate::audio::AUDIO_FORMATS
            },
            "-i",
            audio_path,
        ]
        .into_iter()
        .map(str::to_owned),
    );
    if overlays.is_empty() {
        let map = format!("0:{}", source.stream());
        let filter = match timing {
            AudioTiming::Original(duration) => {
                format!("{filter},fps={fps},trim=duration={duration}")
            }
            AudioTiming::Prepared(_) => filter,
        };
        args.extend(
            ["-map", &map, "-vf", &filter]
                .into_iter()
                .map(str::to_owned),
        );
    } else {
        for (layer, kind) in overlays {
            args.extend(visual_input_args(&layer.path, *kind, &fps));
        }
        let (mut graph, mut output) = layered_filter(&filter, source, overlays, settings);
        if let AudioTiming::Original(duration) = timing {
            use std::fmt::Write;
            write!(graph, ";{output}trim=duration={duration}[timed]")
                .expect("writing to a String cannot fail");
            output = "[timed]".into();
        }
        args.extend([
            "-filter_complex_threads".into(),
            "1".into(),
            "-filter_complex".into(),
            graph,
            "-map".into(),
            output,
        ]);
    }
    args.extend(
        ["-map", "1:a:0", "-map_metadata", "-1"]
            .into_iter()
            .map(str::to_owned),
    );
    args.extend(settings.encoder.args(settings.crf, settings.fps));
    args.extend(
        [
            "-color_range",
            "tv",
            "-r",
            &fps,
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ]
        .into_iter()
        .map(str::to_owned),
    );
    if let AudioTiming::Prepared(duration) = timing {
        args.extend(["-t".into(), duration.into()]);
    }
    args.extend(["-f", "mp4", temporary_path].into_iter().map(str::to_owned));
    args
}
