# PWA 图标批量裁剪脚本
# 用法：在 PowerShell 里执行 .\resize-icons.ps1
# 源图：icon.png (2048x2048)
# 输出：icon-192.png / icon-512.png / apple-touch-icon.png / icon-maskable-512.png

Add-Type -AssemblyName System.Drawing

$src = "D:\Openclaw\.openclaw\workspace-projects\P2-readdeep\02-代码层\readdeep-cf-deploy\public\icons\icon.png"
$dir = "D:\Openclaw\.openclaw\workspace-projects\P2-readdeep\02-代码层\readdeep-cf-deploy\public\icons"

# 4 个尺寸配置：(输出文件名, 尺寸, 是否加 padding 给 maskable)
$targets = @(
    @{ name = "icon-192.png";            size = 192;  pad = 0    },
    @{ name = "icon-512.png";            size = 512;  pad = 0    },
    @{ name = "apple-touch-icon.png";    size = 180;  pad = 0    },
    @{ name = "icon-maskable-512.png";   size = 512;  pad = 0.10 }  # 10% padding（中间安全区）
)

$srcImg = [System.Drawing.Image]::FromFile($src)
Write-Host "源图尺寸: $($srcImg.Width)x$($srcImg.Height)" -ForegroundColor Cyan

foreach ($t in $targets) {
    $size = $t.size
    $pad  = $t.pad
    $name = $t.name
    $dst  = Join-Path $dir $name

    # 计算内框（maskable 留 10% padding，让内容落在 80% 安全区）
    $inner = [int]($size * (1 - $pad * 2))
    $offset = [int](($size - $inner) / 2)

    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($pad -gt 0) {
        # maskable：透明背景 + 居中图
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($srcImg, $offset, $offset, $inner, $inner)
    } else {
        # 普通图标：高质缩放铺满
        $g.DrawImage($srcImg, 0, 0, $size, $size)
    }

    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "  ✓ $name ($($size)x$($size))  generated" -ForegroundColor Green
}

$srcImg.Dispose()
Write-Host ""
Write-Host "全部完成！4 个图标已就位。" -ForegroundColor Cyan
Write-Host "manifest.json 引用：icon-192.png / icon-512.png / icon-maskable-512.png"
Write-Host "iOS 用：apple-touch-icon.png（需要单独在 HTML 加 link，主公要不要加？）"
