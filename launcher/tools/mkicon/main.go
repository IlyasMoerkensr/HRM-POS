// Maakt icon.ico (16, 24, 32, 48, 64, 256 px) voor HRM-Kassa.exe en het pictogram naast de klok.
// Een eenvoudige kassa: blauw vlak, wit scherm en witte lade.
package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

func roundedRect(img *image.RGBA, x0, y0, x1, y1, r float64, c color.RGBA) {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			if px < x0 || px > x1 || py < y0 || py > y1 {
				continue
			}
			dx := math.Max(math.Max(x0+r-px, px-(x1-r)), 0)
			dy := math.Max(math.Max(y0+r-py, py-(y1-r)), 0)
			if dx*dx+dy*dy <= r*r {
				img.Set(x, y, c)
			}
		}
	}
}

func draw(size int) []byte {
	s := float64(size)
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	blue := color.RGBA{0x25, 0x63, 0xeb, 0xff}
	white := color.RGBA{0xff, 0xff, 0xff, 0xff}
	dark := color.RGBA{0x1e, 0x3a, 0x8a, 0xff}
	roundedRect(img, 0, 0, s, s, s*0.22, blue)
	roundedRect(img, s*0.22, s*0.18, s*0.78, s*0.44, s*0.05, white) // scherm
	roundedRect(img, s*0.30, s*0.25, s*0.70, s*0.37, s*0.02, dark)  // display
	roundedRect(img, s*0.14, s*0.52, s*0.86, s*0.84, s*0.06, white) // kast
	roundedRect(img, s*0.24, s*0.66, s*0.76, s*0.70, s*0.01, dark)  // lade
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func main() {
	sizes := []int{16, 24, 32, 48, 64, 256}
	var out bytes.Buffer
	binary.Write(&out, binary.LittleEndian, []uint16{0, 1, uint16(len(sizes))})
	images := make([][]byte, len(sizes))
	offset := 6 + 16*len(sizes)
	for i, sz := range sizes {
		images[i] = draw(sz)
		w := byte(sz)
		if sz == 256 {
			w = 0
		}
		out.Write([]byte{w, w, 0, 0})
		binary.Write(&out, binary.LittleEndian, []uint16{1, 32})
		binary.Write(&out, binary.LittleEndian, []uint32{uint32(len(images[i])), uint32(offset)})
		offset += len(images[i])
	}
	for _, b := range images {
		out.Write(b)
	}
	if err := os.WriteFile(os.Args[1], out.Bytes(), 0o644); err != nil {
		panic(err)
	}
}
