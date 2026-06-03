# Golf Analytics

Flöde under rundan:
1. Initiering (Tee 1): Klicka på Starta Runda (Wake Lock). Skärmen låses i vaket läge och GPS:en börjar mäta avståndet till center av första greenen.

2. Utslag: Läs av Avståndet för strategiskt beslut. Klicka på motsvarande knapp (t.ex. Driver). Knappen bekräftar valet visuellt och din exakta koordinat sparas direkt till IndexedDB.

3. Transport: Gå mot bollen. Avståndet på skärmen tickar ner i realtid via watchPosition-loopen.

4. Nästa slag: Framme vid bollen ser du det uppdaterade avståndet. Klicka på vald klubba (t.ex. Järn Kort) för att spara slagets startposition.

5. På Green: Klicka på Putter-knappen för varje enskild putt du slår tills bollen är i hål.

6. Nästa hål: Klicka på pilen ► i headern. Appen byter fokus till Hål 2 och ställer om avståndsberäkningen mot nästa green.

7. Export: Efter Hål 9, klicka på Exportera Runddata för att ladda ner all samlad slagstatistik som en JSON-fil.
