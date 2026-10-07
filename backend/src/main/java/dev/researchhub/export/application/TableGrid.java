package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report.*;
import java.util.*;

/** Validates rectangular merged tables and supplies explicit cells for Word's vertical merge continuations. */
public record TableGrid(List<List<Slot>> rows,int columns) {
    public record Slot(Cell cell,boolean continuation) {}
    public static TableGrid of(Table table) {
        if (table.rows().isEmpty()) throw new IllegalArgumentException("Empty table");
        int columns=table.rows().getFirst().stream().mapToInt(Cell::colspan).sum();
        if (columns<1 || columns>20) throw new IllegalArgumentException("Export tables support 1 to 20 columns");
        Slot[][] grid=new Slot[table.rows().size()][columns];
        for (int r=0;r<grid.length;r++) {
            int c=0;
            for (var cell:table.rows().get(r)) {
                while (c<columns && grid[r][c]!=null) c++;
                if (cell.colspan()<1 || cell.rowspan()<1 || c+cell.colspan()>columns || r+cell.rowspan()>grid.length)
                    throw new IllegalArgumentException("Invalid merged table");
                for (int y=r;y<r+cell.rowspan();y++) for (int x=c;x<c+cell.colspan();x++) {
                    if (grid[y][x]!=null) throw new IllegalArgumentException("Overlapping table cells");
                    grid[y][x]=new Slot(cell,y!=r);
                }
                c+=cell.colspan();
            }
            for (Slot slot:grid[r]) if (slot==null) throw new IllegalArgumentException("Nonrectangular table");
        }
        return new TableGrid(Arrays.stream(grid).map(row -> List.of(row)).toList(),columns);
    }
}
