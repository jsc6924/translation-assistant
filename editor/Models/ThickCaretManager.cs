using System;
using Avalonia;
using Avalonia.Media;
using Avalonia.Threading;
using AvaloniaEdit;
using AvaloniaEdit.Rendering;

public class ThickCaretManager
{
    private readonly TextEditor _editor;
    private readonly DispatcherTimer _blinkTimer;
    private readonly double _thickness;
    private bool _blinkOn = true;

    public ThickCaretManager(TextEditor editor, double thickness = 2)
    {
        _editor = editor;
        _thickness = thickness;
        
        // 1. 让原生光标透明，使用自定义的粗光标渲染。
        _editor.TextArea.CaretBrush = Brushes.Transparent;

        // 3. 挂载自定义渲染器来画粗光标
        _editor.TextArea.TextView.BackgroundRenderers.Add(new ThickCaretRenderer(this));

        // 4. 建立闪烁定时器
        _blinkTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _blinkTimer.Tick += (s, e) =>
        {
            _blinkOn = !_blinkOn;
            _editor.TextArea.TextView.InvalidateVisual(); 
        };
        _blinkTimer.Start();

        // 5. 事件状态联动
        _editor.TextArea.Caret.PositionChanged += OnCaretReset;
        _editor.TextArea.GotFocus += OnCaretReset;
        _editor.TextArea.LostFocus += OnCaretReset;
    }

    private void OnCaretReset(object? sender, EventArgs e)
    {
        _blinkOn = true;
        _blinkTimer.Stop();
        _blinkTimer.Start();
        _editor.TextArea.TextView.InvalidateVisual();
    }

    // 内部渲染器
    private class ThickCaretRenderer : IBackgroundRenderer
    {
        private readonly ThickCaretManager _manager;
        public KnownLayer Layer => KnownLayer.Background;

        public ThickCaretRenderer(ThickCaretManager manager)
        {
            _manager = manager;
        }

        public void Draw(TextView textView, DrawingContext drawingContext)
        {
            // 如果处于闪烁的“暗”相位，或者编辑器根本没有聚焦，就不画光标
            if (!_manager._blinkOn || !_manager._editor.TextArea.IsFocused)
                return;

            // 算出当前原生光标的精准绝对坐标（相对于整篇文档）
            Rect rect = _manager._editor.TextArea.Caret.CalculateCaretRectangle();
            if (rect.Width == 0 || rect.Height == 0) return;

            // 【核心修复】：将文档绝对坐标减去当前的滚动偏移量（ScrollOffset）
            // 这样就能精准转换为当前屏幕可视区域的相对坐标
            double x = rect.X - textView.ScrollOffset.X;
            double y = rect.Y - textView.ScrollOffset.Y;

            // 基于调整后的可视区域坐标，构建粗光标矩形
            Rect thickCaretRect = new Rect(x, y, _manager._thickness, rect.Height);

            // 画出加粗光标
            var caretBrush = _manager.GetCaretBrush();
            drawingContext.DrawRectangle(caretBrush, null, thickCaretRect);
        }
    }

    private IBrush GetCaretBrush()
    {
        if (Application.Current?.Resources.TryGetResource("EditorCaretBrush", null, out var resource) == true
            && resource is IBrush resourceBrush)
        {
            return resourceBrush;
        }

        return _editor.TextArea.CaretBrush ?? Brushes.White;
    }
}