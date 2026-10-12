"""Generate a private, synthetic fixture for native camera-roll smoke tests."""
import struct
import sys
import zlib

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

pixels = b''.join(b'\0' + bytes([45, 110, 175]) * 64 for _ in range(64))
image = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 64, 64, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
with open(sys.argv[1], 'wb') as destination:
    destination.write(image)
