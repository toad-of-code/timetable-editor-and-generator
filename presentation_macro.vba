Sub GeneratePresentationFromMarkdown()
    Dim filePath As String
    ' The exact absolute path to your markdown script
    filePath = "c:\Users\RAHUL ROY\OneDrive\Desktop\Time_Table_Project\timetable-editor-and-generator\presentation_script.md"
    
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    
    If Not fso.FileExists(filePath) Then
        MsgBox "File not found: " & filePath
        Exit Sub
    End If
    
    Dim textStream As Object
    ' Open file for reading
    Set textStream = fso.OpenTextFile(filePath, 1, False, -2) 
    
    Dim myPres As Presentation
    On Error Resume Next
    Set myPres = ActivePresentation
    On Error GoTo 0
    
    If myPres Is Nothing Then
        Set myPres = Application.Presentations.Add
        myPres.Slides.Add 1, ppLayoutTitle ' Add a dummy title slide to initialize properly
    End If
    
    ' --- Apply Text Beauty (Global Styling) ---
    On Error Resume Next
    myPres.SlideMaster.Background.Fill.ForeColor.RGB = RGB(250, 252, 255) ' Subtle off-white background
    
    With myPres.SlideMaster.Shapes.Title.TextFrame.TextRange.Font
        .Name = "Segoe UI Semibold"
        .Color.RGB = RGB(41, 60, 85) ' Dark Blue
    End With
    
    If myPres.SlideMaster.Shapes.Count >= 2 Then
        With myPres.SlideMaster.Shapes(2).TextFrame.TextRange.Font
            .Name = "Segoe UI"
            .Color.RGB = RGB(60, 70, 80) ' Slate grey
        End With
    End If
    On Error GoTo 0
    
    Dim currentSlide As Slide
    Dim contentShape As Shape
    Dim line As String
    Dim cleanText As String
    Dim slideTitle As String
    
    Dim trimmedLine As String
    Do While Not textStream.AtEndOfStream
        line = textStream.ReadLine
        trimmedLine = Trim(line)
        
        ' 1. Detect Slide Titles (Lines starting with "## ")
        If Left(trimmedLine, 3) = "## " Then
            slideTitle = Trim(Mid(trimmedLine, 4))
            
            ' Strip out the "Slide X: " part
            If InStr(slideTitle, "Slide") > 0 And InStr(slideTitle, ":") > 0 Then
                slideTitle = Trim(Mid(slideTitle, InStr(slideTitle, ":") + 1))
            End If
            
            ' Add a new slide with Title and Content layout
            Set currentSlide = myPres.Slides.Add(myPres.Slides.Count + 1, ppLayoutText)
            currentSlide.Shapes.Title.TextFrame.TextRange.Text = slideTitle
            
            ' If it is the Review of Literature slide, draw the exact table!
            If slideTitle = "Review of Literature" Then
                Call CreateLiteratureTable(currentSlide)
            Else
                ' Otherwise clear any default text in the content placeholder for bullets
                Set contentShape = currentSlide.Shapes(2)
                contentShape.TextFrame.TextRange.Text = ""
            End If
            
        ' 2. Detect Content (Lines starting with "* ")
        ElseIf Left(trimmedLine, 2) = "* " Then
            If Not currentSlide Is Nothing Then
                ' Don't write content onto the Literature Review slide, the table replaces them
                If currentSlide.Shapes.Title.TextFrame.TextRange.Text <> "Review of Literature" Then
                    Dim isSubBullet As Boolean
                    ' Detect spaces or tabs from the UNTRIMMED line
                    isSubBullet = (Left(line, 2) = "  " Or Left(line, 1) = vbTab)
                    
                    ' Extract the text after the asterisk and space
                    cleanText = Trim(Mid(trimmedLine, 3))
                    
                    ' Clean up Markdown and LaTeX artifacts
                    cleanText = Replace(cleanText, "**", "")
                    cleanText = Replace(cleanText, "$", "")
                    cleanText = Replace(cleanText, "\", "")
                    cleanText = Replace(cleanText, "rightarrow", "->")
                    
                    ' Add text to current slide
                    Set contentShape = currentSlide.Shapes(2)
                    Dim prg As Object
                    With contentShape.TextFrame.TextRange
                        If Len(.Text) = 0 Then
                            .Text = cleanText
                        Else
                            .Text = .Text & vbCrLf & cleanText
                        End If
                        Set prg = .Paragraphs(.Paragraphs.Count)
                    End With
                    
                    ' Native PowerPoint Bullets
                    prg.ParagraphFormat.Bullet.Type = 1 ' ppBulletUnnumbered
                    If isSubBullet Then
                        prg.IndentLevel = 2
                    Else
                        prg.IndentLevel = 1
                    End If
                    
                    ' Bold text before and including colon
                    Dim colonPos As Integer
                    colonPos = InStr(1, cleanText, ":")
                    If colonPos > 0 Then
                        prg.Characters(1, colonPos).Font.Bold = msoTrue
                    End If
                End If
            End If
        End If
    Loop
    
    textStream.Close
    MsgBox "PowerPoint Presentation generation complete with custom Table!"
End Sub

Sub CreateLiteratureTable(sld As Slide)
    ' Delete the default text placeholder to make room for the table
    On Error Resume Next
    sld.Shapes(2).Delete
    On Error GoTo 0
    
    Dim tbl As Shape
    ' Create Table (5 Rows, 5 Columns) at coordinates (Left, Top, Width, Height)
    Set tbl = sld.Shapes.AddTable(5, 5, 20, 100, 680, 400)
    
    ' Set column widths visually
    tbl.Table.Columns(1).Width = 110
    tbl.Table.Columns(2).Width = 150
    tbl.Table.Columns(3).Width = 160
    tbl.Table.Columns(4).Width = 160
    tbl.Table.Columns(5).Width = 100
    
    ' ------------- Headers -------------
    tbl.Table.Cell(1, 1).Shape.TextFrame.TextRange.Text = "Method / Technique"
    tbl.Table.Cell(1, 2).Shape.TextFrame.TextRange.Text = "Key Idea"
    tbl.Table.Cell(1, 3).Shape.TextFrame.TextRange.Text = "Advantages"
    tbl.Table.Cell(1, 4).Shape.TextFrame.TextRange.Text = "Limitations"
    tbl.Table.Cell(1, 5).Shape.TextFrame.TextRange.Text = "Reference"
    
    ' ------------- Row 2: GA -------------
    tbl.Table.Cell(2, 1).Shape.TextFrame.TextRange.Text = "Genetic Algorithm (GA)"
    tbl.Table.Cell(2, 2).Shape.TextFrame.TextRange.Text = "Represents timetables as chromosomes and evolves them using crossover and mutation."
    tbl.Table.Cell(2, 3).Shape.TextFrame.TextRange.Text = "Explores a large search space and improves solutions over generations."
    tbl.Table.Cell(2, 4).Shape.TextFrame.TextRange.Text = "Crossover frequently breaks structures, requiring complex repair tools."
    tbl.Table.Cell(2, 5).Shape.TextFrame.TextRange.Text = "Burke et al."

    ' ------------- Row 3: MOSA -------------
    tbl.Table.Cell(3, 1).Shape.TextFrame.TextRange.Text = "Multi-Objective Simulated Annealing (MOSA)"
    tbl.Table.Cell(3, 2).Shape.TextFrame.TextRange.Text = "Uses simulated annealing to optimize multiple objectives simultaneously."
    tbl.Table.Cell(3, 3).Shape.TextFrame.TextRange.Text = "Can escape local optima and handles multiple objectives."
    tbl.Table.Cell(3, 4).Shape.TextFrame.TextRange.Text = "Slow convergence for datasets; robustness checks require expensive repairs."
    tbl.Table.Cell(3, 5).Shape.TextFrame.TextRange.Text = "Gülcü & Akkan"
    
    ' ------------- Row 4: ES -------------
    tbl.Table.Cell(4, 1).Shape.TextFrame.TextRange.Text = "Evolution Strategy (1+1-ES)"
    tbl.Table.Cell(4, 2).Shape.TextFrame.TextRange.Text = "Maintains a single solution and iterates using mutation only."
    tbl.Table.Cell(4, 3).Shape.TextFrame.TextRange.Text = "Lower cost (evaluates one candidate); avoids destructive crossover."
    tbl.Table.Cell(4, 4).Shape.TextFrame.TextRange.Text = "Requires extremely careful design of mutation operators."
    tbl.Table.Cell(4, 5).Shape.TextFrame.TextRange.Text = "Srivastava et al."
    
    ' ------------- Row 5: Improved ES -------------
    tbl.Table.Cell(5, 1).Shape.TextFrame.TextRange.Text = "Improved ES with Preprocessing"
    tbl.Table.Cell(5, 2).Shape.TextFrame.TextRange.Text = "Combines ES with preprocessing techniques and structured mutation."
    tbl.Table.Cell(5, 3).Shape.TextFrame.TextRange.Text = "Faster convergence speed and produces much higher quality schedules."
    tbl.Table.Cell(5, 4).Shape.TextFrame.TextRange.Text = "Implementation complexity slightly higher."
    tbl.Table.Cell(5, 5).Shape.TextFrame.TextRange.Text = "Srivastava et al."
    
    ' ------------- Formatting -------------
    Dim i As Integer, j As Integer
    For i = 1 To 5
        For j = 1 To 5
            With tbl.Table.Cell(i, j).Shape.TextFrame.TextRange
                .Font.Name = "Segoe UI"
                .Font.Size = 12
                .Font.Color.RGB = RGB(60, 70, 80)
                If i = 1 Then 
                    .Font.Bold = msoTrue
                    .Font.Size = 14
                    .Font.Color.RGB = RGB(255, 255, 255) ' White text for header
                    tbl.Table.Cell(i, j).Shape.Fill.ForeColor.RGB = RGB(41, 60, 85) ' Dark blue background
                End If
            End With
        Next j
    Next i
End Sub
