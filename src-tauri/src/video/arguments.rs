//! FFmpeg input arguments, filter graphs and output stream mapping.

use super::{ImageFit, OutputSettings, OverlayLayer};

#[derive(Clone, Copy)]
pub(super) enum VisualKind {
    Png,
    Jpeg,
    Gif,
}

impl VisualKind {
    pub(super) fn from_format(format: &str) -> Result<Self, String> {
        match format {
            "PNG" => Ok(Self::Png),
            "JPEG" => Ok(Self::Jpeg),
            "GIF" => Ok(Self::Gif),
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
        VisualKind::Gif => args.extend(["-f", "gif", "-ignore_loop", "1", "-stream_loop", "-1"]),
        VisualKind::Png | VisualKind::Jpeg => {
            let codec = match source {
                VisualKind::Png => "png",
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
    overlays: &[(&OverlayLayer, VisualKind)],
    settings: OutputSettings,
) -> (String, String) {
    // Normalize the base cadence before framesync so a slow GIF background
    // does not limit the update rate of foreground animations.
    let fps = settings.fps;
    let mut graph = format!("[0:v]{base_filter},fps={fps},setpts=PTS-STARTPTS[base]");
    let mut previous = "base".to_owned();
    for (index, (layer, _)) in overlays.iter().enumerate() {
        let input = index + 2; // 0: base visual, 1: audio.
        let (x, y, width, height) = layer.pixel_rect(settings);
        let alpha = f64::from(layer.opacity) / 100.0;
        use std::fmt::Write;
        write!(
            graph,
            ";[{input}:v]setpts=PTS-STARTPTS,format=rgba,\
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

pub(super) fn encoder_args(
    audio_path: &str,
    visual_path: &str,
    source: VisualKind,
    temporary_path: &str,
    settings: OutputSettings,
    filtered_duration: Option<&str>,
    overlays: &[(&OverlayLayer, VisualKind)],
) -> Vec<String> {
    let fps = settings.fps.to_string();
    let crf = settings.crf.to_string();
    let filter = if matches!(source, VisualKind::Gif) && matches!(settings.fit, ImageFit::Blurred) {
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
            "-f",
            if filtered_duration.is_some() {
                "wav"
            } else {
                "mp3"
            },
            "-i",
            audio_path,
        ]
        .into_iter()
        .map(str::to_owned),
    );
    if overlays.is_empty() {
        args.extend(
            ["-map", "0:v:0", "-vf", &filter]
                .into_iter()
                .map(str::to_owned),
        );
    } else {
        for (layer, kind) in overlays {
            args.extend(visual_input_args(&layer.path, *kind, &fps));
        }
        let (graph, output) = layered_filter(&filter, overlays, settings);
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
        [
            "-map",
            "1:a:0",
            "-map_metadata",
            "-1",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            &crf,
            "-pix_fmt",
            "yuv420p",
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
    if let Some(duration) = filtered_duration {
        args.extend(["-t".into(), duration.into()]);
    } else {
        args.push("-shortest".into());
    }
    args.extend(["-f", "mp4", temporary_path].into_iter().map(str::to_owned));
    args
}
