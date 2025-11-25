from PIL import Image, ImageDraw, ImageFont
import sys

# Create a 1024x1024 image with a dark background
size = 1024
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Draw a rounded rectangle background (terminal window)
margin = 100
bg_color = (30, 30, 50, 255)  # Dark blue-gray
draw.rounded_rectangle(
    [(margin, margin), (size - margin, size - margin)],
    radius=80,
    fill=bg_color
)

# Draw a terminal-like header bar
header_height = 120
header_color = (20, 20, 35, 255)
draw.rounded_rectangle(
    [(margin, margin), (size - margin, margin + header_height)],
    radius=80,
    fill=header_color
)

# Draw three colored dots (terminal window controls)
dot_radius = 25
dot_y = margin + header_height // 2
dot_spacing = 70
dot_start_x = margin + 80

colors = [(255, 95, 86, 255), (255, 189, 68, 255), (40, 201, 64, 255)]  # Red, Yellow, Green
for i, color in enumerate(colors):
    x = dot_start_x + i * dot_spacing
    draw.ellipse(
        [(x - dot_radius, dot_y - dot_radius),
         (x + dot_radius, dot_y + dot_radius)],
        fill=color
    )

# Draw a terminal prompt symbol ">"
prompt_size = 400
prompt_color = (100, 200, 255, 255)  # Light blue
prompt_x = size // 2 - prompt_size // 4
prompt_y = size // 2 + 50

# Draw a simple ">" shape using polygon
points = [
    (prompt_x, prompt_y - prompt_size // 2),
    (prompt_x + prompt_size // 2, prompt_y),
    (prompt_x, prompt_y + prompt_size // 2),
    (prompt_x + 80, prompt_y)
]
draw.polygon(points, fill=prompt_color)

# Save the image
img.save('app-icon.png', 'PNG')
print("Icon generated successfully: app-icon.png")
