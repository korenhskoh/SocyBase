from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import csv
import io
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.job import ScrapingJob, ScrapedProfile, ScrapedPost
from app.schemas.export import ExportRequest, FacebookAdsExportRequest

router = APIRouter()

# Standard 18-field format from rapid_profile_scrape.py
FIELDNAMES = [
    "ID", "Name", "First Name", "Last Name",
    "Gender", "Birthday", "Relationship", "Education", "Work",
    "Position", "Hometown", "Location", "Website", "Languages",
    "UsernameLink", "Username", "About", "Updated Time",
]

# Facebook Ads Manager custom audience format
FB_ADS_FIELDNAMES = [
    "email", "phone", "fn", "ln", "ct", "st", "country", "dob", "gender", "zip",
]


@router.get("/{job_id}/csv")
async def export_csv(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify job ownership
    job_result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Get profiles
    result = await db.execute(
        select(ScrapedProfile)
        .where(ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success")
    )
    profiles = result.scalars().all()

    # Generate CSV
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=FIELDNAMES)
    writer.writeheader()

    for p in profiles:
        writer.writerow({
            "ID": p.platform_user_id,
            "Name": p.name or "NA",
            "First Name": p.first_name or "NA",
            "Last Name": p.last_name or "NA",
            "Gender": p.gender or "NA",
            "Birthday": p.birthday or "NA",
            "Relationship": p.relationship_status or "NA",
            "Education": p.education or "NA",
            "Work": p.work or "NA",
            "Position": p.position or "NA",
            "Hometown": p.hometown or "NA",
            "Location": p.location or "NA",
            "Website": p.website or "NA",
            "Languages": p.languages or "NA",
            "UsernameLink": p.username_link or "NA",
            "Username": p.username or "NA",
            "About": p.about or "NA",
            "Updated Time": p.scraped_at.strftime("%Y-%m-%d %H:%M:%S") if p.scraped_at else "NA",
        })

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=socybase_export_{job_id}.csv"},
    )


@router.get("/{job_id}/facebook-ads")
async def export_facebook_ads(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export in Facebook Ads Manager Custom Audience CSV format."""
    job_result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await db.execute(
        select(ScrapedProfile)
        .where(ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success")
    )
    profiles = result.scalars().all()

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=FB_ADS_FIELDNAMES)
    writer.writeheader()

    for p in profiles:
        # Convert birthday format if available (e.g., "January 15, 1990" -> "01151990")
        dob = ""
        if p.birthday and p.birthday != "NA":
            dob = p.birthday  # User may need to manually format

        writer.writerow({
            "email": "",  # Not available from Facebook scraping
            "phone": "",
            "fn": (p.first_name or "").lower(),
            "ln": (p.last_name or "").lower(),
            "ct": (p.location or "").lower(),
            "st": "",
            "country": "",
            "dob": dob,
            "gender": "m" if p.gender and p.gender.lower() == "male" else ("f" if p.gender and p.gender.lower() == "female" else ""),
            "zip": "",
        })

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=socybase_fb_ads_{job_id}.csv"},
    )


# Post discovery export fields
POST_FIELDNAMES = [
    "Post ID", "Message", "Author", "Author ID", "Created",
    "Comments", "Reactions", "Shares", "Type", "URL",
]


@router.get("/{job_id}/xlsx")
async def export_xlsx(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export job data as XLSX. Supports both profile scraping and post discovery jobs."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    job_result = await db.execute(
        select(ScrapingJob).where(
            ScrapingJob.id == job_id,
            ScrapingJob.tenant_id == user.tenant_id,
        )
    )
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    wb = Workbook()
    ws = wb.active

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")

    if job.job_type == "post_discovery":
        ws.title = "Discovered Posts"
        headers = POST_FIELDNAMES

        result = await db.execute(
            select(ScrapedPost).where(ScrapedPost.job_id == job_id)
            .order_by(ScrapedPost.created_time.desc().nulls_last())
        )
        posts = result.scalars().all()

        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

        for row_idx, p in enumerate(posts, 2):
            ws.cell(row=row_idx, column=1, value=p.post_id)
            ws.cell(row=row_idx, column=2, value=(p.message or "")[:500])
            ws.cell(row=row_idx, column=3, value=p.from_name or "")
            ws.cell(row=row_idx, column=4, value=p.from_id or "")
            ws.cell(row=row_idx, column=5, value=p.created_time.strftime("%Y-%m-%d %H:%M:%S") if p.created_time else "")
            ws.cell(row=row_idx, column=6, value=p.comment_count)
            ws.cell(row=row_idx, column=7, value=p.reaction_count)
            ws.cell(row=row_idx, column=8, value=p.share_count)
            ws.cell(row=row_idx, column=9, value=p.attachment_type or "status")
            ws.cell(row=row_idx, column=10, value=p.post_url or "")
    else:
        ws.title = "Scraped Profiles"
        headers = FIELDNAMES

        result = await db.execute(
            select(ScrapedProfile)
            .where(ScrapedProfile.job_id == job_id, ScrapedProfile.scrape_status == "success")
        )
        profiles = result.scalars().all()

        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

        for row_idx, p in enumerate(profiles, 2):
            ws.cell(row=row_idx, column=1, value=p.platform_user_id)
            ws.cell(row=row_idx, column=2, value=p.name or "NA")
            ws.cell(row=row_idx, column=3, value=p.first_name or "NA")
            ws.cell(row=row_idx, column=4, value=p.last_name or "NA")
            ws.cell(row=row_idx, column=5, value=p.gender or "NA")
            ws.cell(row=row_idx, column=6, value=p.birthday or "NA")
            ws.cell(row=row_idx, column=7, value=p.relationship_status or "NA")
            ws.cell(row=row_idx, column=8, value=p.education or "NA")
            ws.cell(row=row_idx, column=9, value=p.work or "NA")
            ws.cell(row=row_idx, column=10, value=p.position or "NA")
            ws.cell(row=row_idx, column=11, value=p.hometown or "NA")
            ws.cell(row=row_idx, column=12, value=p.location or "NA")
            ws.cell(row=row_idx, column=13, value=p.website or "NA")
            ws.cell(row=row_idx, column=14, value=p.languages or "NA")
            ws.cell(row=row_idx, column=15, value=p.username_link or "NA")
            ws.cell(row=row_idx, column=16, value=p.username or "NA")
            ws.cell(row=row_idx, column=17, value=p.about or "NA")
            ws.cell(row=row_idx, column=18, value=p.scraped_at.strftime("%Y-%m-%d %H:%M:%S") if p.scraped_at else "NA")

    # Auto-width columns
    for col in ws.columns:
        max_length = 0
        col_letter = col[0].column_letter
        for cell in col:
            if cell.value:
                max_length = max(max_length, min(len(str(cell.value)), 50))
        ws.column_dimensions[col_letter].width = max_length + 3

    xlsx_output = io.BytesIO()
    wb.save(xlsx_output)
    xlsx_output.seek(0)

    return StreamingResponse(
        iter([xlsx_output.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=socybase_export_{job_id}.xlsx"},
    )
